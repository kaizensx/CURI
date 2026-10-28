// Persistent, resumable first-run state machine. Each step is a typed work package with a durable
// checkpoint; re-running a completed step is a no-op, so crashes/restarts never double-apply.
import fs from 'node:fs';
import path from 'node:path';
import { now, tx } from './db.mjs';
import { audit, jobEvent } from './audit-log.mjs';
import { preflight, inventory } from './env.mjs';
import { importSeeds } from './registry.mjs';
import { planBridgeInstall, applyBridgeInstall, rollback } from './bridge.mjs';
import { verifyResource } from './github.mjs';
import { runVerification } from './verify.mjs';
import { paths, claudeJsonPath, claudeHome } from './paths.mjs';
import { sha256File } from './env.mjs';

export const STATES = ['UNINITIALIZED', 'PREFLIGHT', 'ENVIRONMENT_AUDITED', 'PLAN_READY', 'APPROVAL_REQUIRED', 'PROVISIONING', 'VERIFYING', 'READY', 'PARTIAL_READY', 'BLOCKED', 'FAILED', 'PAUSED', 'CANCELLED', 'ROLLING_BACK', 'RECOVERING', 'UPDATING', 'DEGRADED_OFFLINE'];
const JOB = 'bootstrap';

export const WORK_PACKAGES = [
  { id: 'WP1-preflight', from: ['UNINITIALIZED', 'PREFLIGHT'], to: 'ENVIRONMENT_AUDITED', risk: 'READ_ONLY', title: 'Preflight do dispositivo e inventário Claude (só leitura)' },
  { id: 'WP2-snapshot', from: ['ENVIRONMENT_AUDITED'], to: 'ENVIRONMENT_AUDITED', risk: 'LOCAL_FILE_WRITE', title: 'Snapshot com checksums das configurações Claude (cópias em dados CURI; nada é alterado em ~/.claude)' },
  { id: 'WP3-import', from: ['ENVIRONMENT_AUDITED'], to: 'PLAN_READY', risk: 'READ_ONLY', title: 'Importar o catálogo inicial para o registo (idempotente)' },
  { id: 'WP4-plan', from: ['PLAN_READY'], to: 'APPROVAL_REQUIRED', risk: 'READ_ONLY', title: 'Gerar plano de integração e classes de risco' },
  { id: 'WP5-provision', from: ['APPROVAL_REQUIRED', 'PROVISIONING', 'RECOVERING'], to: 'VERIFYING', risk: 'LOCAL_FILE_WRITE', title: 'Aplicar ações aprovadas (skill + MCP) e verificação opcional de fontes' },
  { id: 'WP6-verify', from: ['VERIFYING'], to: null, risk: 'READ_ONLY', title: 'Verificação independente e veredicto' },
];

export function getState(db) {
  const r = db.prepare('SELECT * FROM bootstrap WHERE id=1').get();
  if (!r) return { state: 'UNINITIALIZED', step: null, data: { completed: {}, decisions: null }, updated_at: null };
  return { ...r, data: JSON.parse(r.data || '{}') };
}

function setState(db, state, step, data, { actor = 'system', evidence = null } = {}) {
  if (!STATES.includes(state)) throw new Error(`Estado inválido ${state}`);
  const prev = getState(db).state;
  tx(db, () => {
    db.prepare('INSERT INTO bootstrap(id,state,step,data,updated_at) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, step=excluded.step, data=excluded.data, updated_at=excluded.updated_at').run(state, step, JSON.stringify(data), now());
    jobEvent(db, JOB, 'info', step, `${prev} → ${state}`, evidence);
    audit(db, actor, 'bootstrap.transition', step, { from: prev, to: state });
  });
}

function checkpoint(db, st, wpId, evidence) {
  st.data.completed ||= {};
  st.data.completed[wpId] = { at: now(), evidence };
}

export function pause(db) {
  const st = getState(db);
  if (['READY', 'PARTIAL_READY', 'CANCELLED'].includes(st.state)) return st;
  st.data.pausedFrom = st.state;
  setState(db, 'PAUSED', st.step, st.data, { actor: 'user' });
  return getState(db);
}

export function resume(db) {
  const st = getState(db);
  if (st.state !== 'PAUSED') return st;
  const back = st.data.pausedFrom || 'UNINITIALIZED';
  delete st.data.pausedFrom;
  setState(db, back, st.step, st.data, { actor: 'user' });
  return getState(db);
}

export function cancel(db) {
  const st = getState(db);
  setState(db, 'CANCELLED', st.step, st.data, { actor: 'user' });
  return getState(db);
}

export async function rollbackBootstrap(db) {
  const st = getState(db);
  setState(db, 'ROLLING_BACK', st.step, st.data, { actor: 'user' });
  const txId = st.data.completed?.['WP5-provision']?.evidence?.bridge?.tx;
  const r = txId ? await rollback(db, txId, { actor: 'user' }) : { status: 'nothing_to_rollback' };
  const fresh = getState(db);
  delete fresh.data.completed?.['WP5-provision'];
  delete fresh.data.completed?.['WP6-verify'];
  fresh.data.decisions = null;
  setState(db, r.status === 'rollback_partial' ? 'FAILED' : 'APPROVAL_REQUIRED', 'WP5-provision', fresh.data, { actor: 'user', evidence: r });
  return { rollback: r, state: getState(db) };
}

// On app start: a run interrupted mid-provisioning resumes from its first unverified checkpoint.
export function recoverIfInterrupted(db) {
  const st = getState(db);
  if (['PROVISIONING', 'VERIFYING', 'PREFLIGHT'].includes(st.state)) {
    setState(db, 'RECOVERING', st.step, st.data, { evidence: { interrupted_state: st.state } });
    const next = st.state === 'PREFLIGHT' ? 'UNINITIALIZED' : st.data.completed?.['WP5-provision'] ? 'VERIFYING' : 'PROVISIONING';
    setState(db, next, st.step, getState(db).data);
    return { recovered: true, from: st.state, to: next };
  }
  return { recovered: false };
}

// Advances through steps until approval is needed or a terminal state is reached.
export async function advance(db, { decisions, onEvent = () => {} } = {}) {
  let st = getState(db);
  if (st.state === 'PAUSED' || st.state === 'CANCELLED') return st;
  if (decisions) {
    st.data.decisions = { ...decisions, decided_at: now() };
    if (st.state === 'APPROVAL_REQUIRED') { setState(db, 'PROVISIONING', 'WP5-provision', st.data, { actor: 'user', evidence: { decisions } }); st = getState(db); }
  }
  for (let guard = 0; guard < 12; guard++) {
    st = getState(db);
    if (['READY', 'PARTIAL_READY', 'FAILED', 'BLOCKED', 'PAUSED', 'CANCELLED'].includes(st.state)) return st;
    if (st.state === 'APPROVAL_REQUIRED' && !st.data.decisions) return st;
    const done = st.data.completed || {};
    if (st.state === 'UNINITIALIZED' || st.state === 'PREFLIGHT') {
      setState(db, 'PREFLIGHT', 'WP1-preflight', st.data);
      const pf = await preflight();
      const inv = inventory();
      st = getState(db);
      st.data.preflight = pf;
      st.data.inventory = { skills: inv.skills.map(s => ({ name: s.name, scope: s.scope, managed_by_curi: s.managed_by_curi, security: s.security })), mcp: inv.mcp.map(m => ({ name: m.name, scope: m.scope, transport: m.transport, env_keys: m.env_keys })), conflicts: inv.conflicts, claude_md: inv.claude_md, settings_keys: inv.settings_keys };
      checkpoint(db, st, 'WP1-preflight', { claude: pf.claude, network: pf.network });
      setState(db, 'ENVIRONMENT_AUDITED', 'WP1-preflight', st.data);
      onEvent('WP1-preflight');
      continue;
    }
    if (st.state === 'ENVIRONMENT_AUDITED' && !done['WP2-snapshot']) {
      const dir = path.join(paths.backups, `pre-bootstrap-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const files = [claudeJsonPath(), path.join(claudeHome(), 'settings.json'), path.join(claudeHome(), 'CLAUDE.md')];
      const manifest = files.map(f => {
        if (!fs.existsSync(f)) return { path: f, existed: false };
        const dest = path.join(dir, path.basename(f));
        fs.copyFileSync(f, dest); fs.chmodSync(dest, 0o600);
        return { path: f, existed: true, sha256: sha256File(f), backup: dest };
      });
      const skillsDir = path.join(claudeHome(), 'skills');
      const skillSums = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).map(n => ({ name: n, sha256: sha256File(path.join(skillsDir, n, 'SKILL.md')) })) : [];
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ files: manifest, skills: skillSums, at: now() }, null, 2));
      checkpoint(db, st, 'WP2-snapshot', { dir, files: manifest.map(m => ({ path: m.path, existed: m.existed, sha256: m.sha256 })) });
      setState(db, 'ENVIRONMENT_AUDITED', 'WP2-snapshot', st.data);
      onEvent('WP2-snapshot');
      continue;
    }
    if (st.state === 'ENVIRONMENT_AUDITED') {
      const rep = importSeeds(db);
      const { seedFacts } = await import('./facts.mjs');
      rep.facts = seedFacts(db);
      st = getState(db);
      checkpoint(db, st, 'WP3-import', { created: rep.created, linked: rep.linkedExisting, unique_urls: rep.uniqueOriginalUrls, occurrences: rep.urlOccurrences, after: rep.resourcesAfter, invalid: rep.invalid.length });
      setState(db, 'PLAN_READY', 'WP3-import', st.data);
      onEvent('WP3-import');
      continue;
    }
    if (st.state === 'PLAN_READY') {
      const plan = planBridgeInstall();
      st.data.plan = { actions: plan.actions.map(({ preview, ...a }) => a), conflicts: plan.conflicts, untouched: plan.untouched, claude_binary: plan.claude_binary,
        optional: [{ id: 'network.verify', risk: 'NETWORK_DISCOVERY', title: 'Verificar fontes online (git ls-remote + GitHub API sem token, limitado)' }, { id: 'claude.clean_session', risk: 'COST_BEARING', title: 'Teste de sessão Claude limpa (usa a sua conta Claude Code; consome uso)' }] };
      checkpoint(db, st, 'WP4-plan', { actions: plan.actions.length, conflicts: plan.conflicts.length });
      setState(db, 'APPROVAL_REQUIRED', 'WP4-plan', st.data);
      onEvent('WP4-plan');
      continue;
    }
    if (st.state === 'PROVISIONING' || st.state === 'RECOVERING') {
      const d = st.data.decisions || {};
      const ev = {};
      if ((d.approve || []).length) {
        const r = await applyBridgeInstall(db, { approve: d.approve, actor: 'user' });
        ev.bridge = { applied: r.applied, reason: r.reason, tx: r.tx || st.data.completed?.['WP5-provision']?.evidence?.bridge?.tx || null, error: r.error, conflicts: r.conflicts };
        if (r.reason === 'failed') { st = getState(db); checkpoint(db, st, 'WP5-provision', ev); setState(db, 'FAILED', 'WP5-provision', st.data, { evidence: ev }); return getState(db); }
      } else ev.bridge = { skipped: true, reason: 'utilizador não aprovou integração Claude' };
      if (d.networkVerify) {
        const ids = db.prepare('SELECT id FROM resources WHERE last_verified IS NULL ORDER BY (gh_full_name IS NULL), id LIMIT ?').all(d.networkVerifyLimit ?? 40).map(r => r.id);
        let ok = 0, fail = 0;
        for (const id of ids) {
          try { const r = await verifyResource(db, id, { useApi: false }); r.checks.some(c => c.exists === true || c.ok) ? ok++ : fail++; } catch { fail++; }
        }
        ev.network_verify = { attempted: ids.length, ok, fail };
      }
      st = getState(db);
      checkpoint(db, st, 'WP5-provision', ev);
      setState(db, 'VERIFYING', 'WP5-provision', st.data, { evidence: ev });
      onEvent('WP5-provision');
      continue;
    }
    if (st.state === 'VERIFYING') {
      const d = st.data.decisions || {};
      const requireBridge = (d.approve || []).length > 0;
      const v = await runVerification(db, { requireBridge, cleanSession: Boolean(d.cleanSession) });
      st = getState(db);
      let verdict = v.verdict;
      if (verdict === 'READY' && !requireBridge) verdict = 'PARTIAL_READY';
      checkpoint(db, st, 'WP6-verify', { verdict, receipt_file: v.receipt_file, passed: v.passed, total: v.total, mandatory_failed: v.mandatory_failed, optional_unavailable: v.optional_unavailable, missing: requireBridge ? [] : ['integração Claude não aprovada'] });
      setState(db, verdict, 'WP6-verify', st.data, { evidence: { verdict } });
      onEvent('WP6-verify');
      return getState(db);
    }
    return st;
  }
  return getState(db);
}

// Routine launch: integrity + version check only. Never re-runs provisioning.
export async function launchCheck(db) {
  const rec = recoverIfInterrupted(db);
  const st = getState(db);
  const integrity = Object.values(db.prepare('PRAGMA quick_check').get())[0];
  return { state: st.state, recovered: rec, integrity, needs_onboarding: !['READY', 'PARTIAL_READY'].includes(st.state) };
}
