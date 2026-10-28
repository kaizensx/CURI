// Single action layer shared by the desktop UI server (and usable by the CLI). Every action is
// allowlisted with typed params; there is no generic command pass-through.
import { now } from './db.mjs';
import { search, compare } from './search.mjs';
import { addUrl, getResource, listResources, setStatus, exportRegistry, importRegistry, STATUSES } from './registry.mjs';
import { discover, listCandidates, promoteCandidate, rejectCandidate, gapAudit, starVelocity } from './discover.mjs';
import { verifyResource } from './github.mjs';
import { resourceAudit } from './audit.mjs';
import { preflight, inventory, findClaudeBinary, mcpHealth } from './env.mjs';
import { planBridgeInstall, applyBridgeInstall, rollback, driftReport } from './bridge.mjs';
import { runVerification } from './verify.mjs';
import { statusSummary } from './status.mjs';
import { installPlan } from './plans.mjs';
import { scanText } from './security.mjs';
import { getPref, setPref } from './db.mjs';
import * as boot from './bootstrap.mjs';
import { verifyChain } from './audit-log.mjs';
import { detectCapabilities } from './taxonomy.mjs';
import fs from 'node:fs';
import * as claudeAuth from './claude-auth.mjs';
import * as conns from './connections.mjs';
import * as policy from './policy.mjs';
import * as ops from './operations.mjs';
import { agentStatus, skillTarget, mcpLauncherSpec } from './installers.mjs';
import { runClaudeJob } from './claude-runner.mjs';
import { CORE_ROOT } from './paths.mjs';
import { clearGithubTokenCache } from './github.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths } from './paths.mjs';
import { openExternal as platformOpen, deviceInfo } from './platform.mjs';
import { resourceView, presenceOf } from './actions.mjs';
import { profileFor, deviceContext, getFacts } from './facts.mjs';
import { lastScan } from './detect.mjs';
import { capabilityMap, compareDecision, capLabel } from './capabilities.mjs';
import { maintenancePass, maintenanceStatus } from './maintenance.mjs';
import { agentRelevance } from './relevance.mjs';
import { listProjects, addProject, hideProject } from './projects.mjs';
import { adoptCandidate, installSummary } from './candidates.mjs';
import { allMarks, setMark, collections, addCollection, removeCollection } from './marks.mjs';

const S = (v, max = 500) => { if (typeof v !== 'string' || v.length > max) throw new Error('invalid text parameter'); return v; };
const optS = (v, max) => (v == null || v === '' ? undefined : S(v, max));
const I = (v, d, min, max) => { if (v == null) return d; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error('invalid numeric parameter'); return n; };
const ids = v => { if (!Array.isArray(v) || v.length < 2 || v.length > 5) throw new Error('ids: 2 a 5'); return v.map(x => S(x, 300)); };

const running = new Map();

export const ACTIONS = {
  status: db => statusSummary(db),
  preflight: () => preflight(),
  inventory: () => inventory(),
  search: (db, p) => search(db, S(p.query), { limit: I(p.limit, 12, 1, 100), type: optS(p.type, 30), status: optS(p.status, 30), capability: optS(p.capability, 60), tier: optS(p.tier, 20), license: optS(p.license, 40) }),
  suggest: (db, p) => detectCapabilities(S(p.task, 1000)),
  list: (db, p) => (p.status === 'here'
    ? [...listResources(db, { status: 'INSTALLED', type: optS(p.type, 30), capability: optS(p.capability, 60), limit: 2000 }), ...listResources(db, { status: 'CONFIGURED', type: optS(p.type, 30), capability: optS(p.capability, 60), limit: 2000 })]
    : listResources(db, { status: optS(p.status, 30), type: optS(p.type, 30), capability: optS(p.capability, 60), tier: optS(p.tier, 20), limit: I(p.limit, 500, 1, 2000) })),
  get: (db, p) => getResource(db, S(p.id, 300)),
  resourceView: (db, p) => {
    const v = resourceView(db, S(p.id, 300));
    if (v) v.capabilities = db.prepare('SELECT capability_id FROM resource_capabilities WHERE resource_id=?').all(v.resource.id).map(x => ({ id: x.capability_id, label: capLabel(x.capability_id) }));
    return v;
  },
  // Library: every resource with its real kind and presence on this device, in one round trip.
  library: db => {
    const ctx = deviceContext(db);
    const marks = allMarks(db);
    const caps = new Map();
    for (const c of db.prepare('SELECT resource_id, capability_id FROM resource_capabilities').all()) { const l = caps.get(c.resource_id) || []; l.push(c.capability_id); caps.set(c.resource_id, l); }
    const WHERE = { app: 'App', bin: 'Executable', brew: 'Homebrew', cask: 'Homebrew', npm: 'npm', pip: 'Python', uv: 'uv', pipx: 'pipx', cargo: 'Cargo', winget: 'WinGet', flatpak: 'Flatpak', scoop: 'Scoop' };
    return db.prepare("SELECT id, name, type, status, description, gh_full_name, canonical_url, license, last_verified, tier FROM resources WHERE status<>'REJECTED' ORDER BY name COLLATE NOCASE").all().map(r => {
      const p = profileFor(db, r.id, ctx);
      const pres = presenceOf(db, r.id);
      const f = getFacts(db, r.id);
      const own = p.options.filter(o => !o.shared);
      return { ...r, description: r.description || f?.description || f?.title || null, kind: p.kind, kind_label: p.kind_label, installable: own.length > 0, ready: own.some(o => o.ready), has_project: p.project_use.length > 0,
        state: pres.state, where: [...new Set(pres.found.map(x => x.agent_label || WHERE[x.type] || x.type).filter(Boolean))], capabilities: caps.get(r.id) || [],
        stars: f?.stars ?? null, pushed_at: f?.pushed_at ?? null, language: f?.language ?? null, license_spdx: f?.license ?? null, archived: Boolean(f?.archived), mine: marks[r.id] || {} };
    });
  },
  mark: (db, p) => setMark(db, S(p.id, 300), p.patch || {}),
  collections: db => collections(db),
  collectionAdd: (db, p) => addCollection(db, S(p.name, 40)),
  collectionRemove: (db, p) => removeCollection(db, S(p.name, 40)),
  device: db => ({ ...deviceInfo(), scan: lastScan(db) }),
  projects: db => listProjects(db),
  savedSearches: db => getPref(db, 'saved_searches', []),
  savedSearchSet: (db, p) => {
    const intent = S(p.intent, 200).trim();
    if (intent.length < 3) throw new Error('Search too short.');
    const list = getPref(db, 'saved_searches', []).filter(x => x.intent !== intent);
    if (!p.remove) list.unshift({ intent, auto: Boolean(p.auto), created: now() });
    setPref(db, 'saved_searches', list.slice(0, 30));
    return list;
  },
  candidateAdopt: (db, p) => adoptCandidate(db, I(p.id, 0, 1, 1e12)),
  promoteMany: (db, p) => (Array.isArray(p.ids) ? p.ids.slice(0, 50) : []).map(id => { try { return promoteCandidate(db, Number(id)); } catch (e) { return { error: e.message }; } }),
  projectAdd: (db, p) => addProject(db, S(p.path, 1000)),
  projectHide: (db, p) => (hideProject(db, S(p.path, 1000)), { ok: true }),
  capabilityMap: db => capabilityMap(db),
  maintenance: db => maintenanceStatus(db),
  maintenanceRun: async db => { const r = await maintenancePass(db, { actor: 'user', force: true }); kickWorker(db); return r; },
  compareDecision: (db, p) => compareDecision(db, ids(p.ids), { useCase: optS(p.useCase, 300) || '' }),
  githubExisting: () => conns.githubExisting(),
  githubAdoptCli: async db => { const r = await conns.adoptGithubCli(db); clearGithubTokenCache(); return r; },
  revealAgentConfig: (db, p) => {
    const a = (lastScan(db)?.agents || []).find(x => x.id === S(p.agent, 40));
    if (!a?.config) throw new Error('This agent has no known configuration file.');
    platformOpen(a.config, { reveal: true });
    return { revealed: a.config };
  },
  add: (db, p) => addUrl(db, S(p.url, 1000), { note: optS(p.note, 2000), source: 'desktop-app', actor: 'user' }),
  setStatus: (db, p) => { if (!STATUSES.includes(p.status)) throw new Error('invalid status'); setStatus(db, S(p.id, 300), p.status, { reason: optS(p.reason, 500) }); return getResource(db, p.id); },
  compare: (db, p) => compare(db, ids(p.ids)),
  installPlan: (db, p) => installPlan(db, S(p.id, 300)),
  verifyResource: (db, p) => verifyResource(db, S(p.id, 300), { useApi: p.useApi !== false }),
  discover: (db, p) => {
    const mode = p.mode === 'frontier' ? 'frontier' : 'task';
    if (running.has('discover')) throw new Error('A discovery is already running.');
    const promise = discover(db, { mode, intent: optS(p.intent, 500) || '', windows: Array.isArray(p.windows) ? p.windows.filter(w => ['24h', '7d', '30d', '90d'].includes(w)) : undefined, maxQueries: I(p.maxQueries, 6, 1, 20), actor: 'user' })
      .finally(() => running.delete('discover'));
    running.set('discover', promise);
    promise.catch(() => {});
    return { started: true, at: now() };
  },
  scans: db => db.prepare('SELECT id, mode, params, status, error, queries, started_at, finished_at, (SELECT COUNT(*) FROM scan_candidates c WHERE c.scan_id=s.id) n FROM scans s ORDER BY id DESC LIMIT 50').all().map(s => ({ ...s, params: JSON.parse(s.params || '{}'), queries: JSON.parse(s.queries || '[]') })),
  // All recent candidates across scans (dashboard + radar overview). Real rows only.
  candidatesAll: (db, p, ctx = deviceContext(db)) => db.prepare(`SELECT c.*, s.mode, s.started_at scan_started, f.data facts_json FROM scan_candidates c JOIN scans s ON s.id=c.scan_id LEFT JOIN candidate_facts f ON f.full_name=c.full_name ORDER BY c.id DESC LIMIT ?`).all(I(p.limit, 300, 1, 2000))
    .map(c => {
      const row = { ...c, topics: JSON.parse(c.topics || '[]'), score: JSON.parse(c.score || 'null') || {}, install: null };
      // Install options are derived on read from the stored inspection, with the current rules.
      if (c.facts_json) { const f = JSON.parse(c.facts_json); row.install = f.reachable ? installSummary(c.full_name, f, ctx) : { installable: false }; }
      delete row.facts_json;
      // Judged on read with the current rules, so improvements apply to everything already found.
      row.score.agent = agentRelevance({ name: row.full_name.split('/')[1], description: row.description, topics: row.topics, stars: row.stars, created_at: row.gh_created_at, pushed_at: row.gh_pushed_at, license: row.license });
      if (['candidate', 'filtered'].includes(row.decision)) { row.decision = row.score.agent.noise ? 'filtered' : 'candidate'; row.reason = row.score.agent.noise || null; }
      return row;
    }),
  // macOS notification for long-running work that finished while the user was elsewhere.
  notify: (db, p) => {
    const title = S(p.title, 120).replace(/["\\]/g, ''), body = S(p.body ?? '', 300).replace(/["\\]/g, '');
    if (process.platform === 'darwin') spawn('osascript', ['-e', `display notification "${body}" with title "${title}"`], { stdio: 'ignore' });
    return { ok: true };
  },
  candidates: (db, p) => listCandidates(db, I(p.scanId, 0, 0, 1e9), { onlyNew: Boolean(p.onlyNew) }),
  promote: (db, p) => promoteCandidate(db, I(p.id, 0, 1, 1e12)),
  reject: (db, p) => (rejectCandidate(db, I(p.id, 0, 1, 1e12), optS(p.reason, 500)), { ok: true }),
  velocity: (db, p) => ['24h', '7d', '30d', '90d'].map(w => starVelocity(db, S(p.fullName, 200), w)),
  gaps: db => gapAudit(db),
  audit: db => resourceAudit(db),
  auditLog: (db, p) => ({ chain: verifyChain(db), entries: db.prepare('SELECT id, ts, actor, action, target, details, hash FROM audit_log ORDER BY id DESC LIMIT ?').all(I(p.limit, 200, 1, 2000)) }),
  jobs: (db, p) => db.prepare('SELECT id, job, ts, level, step, message, data FROM job_events ORDER BY id DESC LIMIT ?').all(I(p.limit, 200, 1, 2000)),
  approvals: db => db.prepare('SELECT * FROM approvals ORDER BY id DESC LIMIT 200').all(),
  transactions: db => db.prepare('SELECT id, kind, status, manifest, created_at, committed_at, rolled_back_at FROM transactions ORDER BY created_at DESC').all().map(t => ({ ...t, manifest: JSON.parse(t.manifest || '{}') })),
  bridgePlan: () => planBridgeInstall(),
  bridgeApply: (db, p) => applyBridgeInstall(db, { approve: Array.isArray(p.approve) ? p.approve.filter(a => ['skill.write', 'mcp.register'].includes(a)) : [] }),
  rollback: (db, p) => rollback(db, S(p.tx, 100)),
  drift: db => driftReport(db),
  verify: (db, p) => runVerification(db, { requireBridge: p.requireBridge !== false, cleanSession: Boolean(p.cleanSession), actor: 'user' }),
  mcpHealth: () => mcpHealth(findClaudeBinary()),
  scanSkill: (db, p) => {
    const inv = inventory();
    const s = inv.skills.find(x => x.dir === S(p.dir, 1000));
    if (!s) throw new Error('Skill not found in the inventory.');
    return scanText(fs.readFileSync(`${s.dir}/SKILL.md`, 'utf8'), { source: s.dir });
  },
  scanText: (db, p) => scanText(S(p.text, 200000), { source: 'pasted by the user' }),
  exportData: db => exportRegistry(db),
  exportFile: db => {
    const data = exportRegistry(db);
    const file = path.join(paths.exports, `curi-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    platformOpen(file, { reveal: true });
    return { file, count: data.count };
  },
  // Opens a public http(s) URL in the user's default browser (the desktop webview has no tabs).
  openExternal: (db, p) => {
    const u = new URL(S(p.url, 2000));
    if (!/^https?:$/.test(u.protocol) || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname)) throw new Error('Public http(s) URLs only.');
    platformOpen(u.toString());
    return { opened: u.toString() };
  },
  importData: (db, p) => importRegistry(db, p.data, { dryRun: p.dryRun !== false }),
  prefsGet: db => ({ discovery_areas: getPref(db, 'discovery_areas', []), github_budget: getPref(db, 'github_budget', 40), install_policy: getPref(db, 'install_policy', 'minimal-global'), telemetry: false, scheduled_scans: getPref(db, 'scheduled_scans', false), model_analysis: getPref(db, 'model_analysis', false) }),
  prefsSet: (db, p) => {
    const allowed = { discovery_areas: v => Array.isArray(v) && v.every(x => typeof x === 'string'), github_budget: v => Number.isInteger(v) && v >= 0 && v <= 5000, install_policy: v => ['minimal-global', 'catalog-only'].includes(v), scheduled_scans: v => v === false, model_analysis: v => typeof v === 'boolean', auto_verify_hours: v => Number.isInteger(v) && v >= 0 && v <= 168, auto_scan_hours: v => Number.isInteger(v) && v >= 0 && v <= 168, auto_repair_hours: v => Number.isInteger(v) && v >= 0 && v <= 168, auto_update_hours: v => Number.isInteger(v) && v >= 0 && v <= 720, auto_package_update_hours: v => Number.isInteger(v) && v >= 0 && v <= 720, auto_discover_hours: v => Number.isInteger(v) && v >= 0 && v <= 720, auto_stars_hours: v => Number.isInteger(v) && v >= 0 && v <= 720, pause_on_battery: v => typeof v === 'boolean', notify_mode: v => ['all', 'errors', 'none'].includes(v), update_repo: v => v === null || /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(v) };
    for (const [k, v] of Object.entries(p)) { if (!allowed[k]?.(v)) throw new Error(`invalid preference: ${k}`); setPref(db, k, v); }
    return ACTIONS.prefsGet(db);
  },
  bootstrapState: db => boot.getState(db),
  bootstrapAdvance: (db, p) => {
    if (running.has('bootstrap')) throw new Error('Setup is already running.');
    let decisions;
    if (p.decisions) decisions = { approve: (p.decisions.approve || []).filter(a => ['skill.write', 'mcp.register'].includes(a)), networkVerify: Boolean(p.decisions.networkVerify), networkVerifyLimit: I(p.decisions.networkVerifyLimit, 40, 0, 400), cleanSession: Boolean(p.decisions.cleanSession) };
    const promise = boot.advance(db, { decisions }).finally(() => running.delete('bootstrap'));
    running.set('bootstrap', promise);
    promise.catch(() => {});
    return { started: true };
  },
  bootstrapPause: db => boot.pause(db),
  bootstrapResume: db => boot.resume(db),
  bootstrapCancel: db => boot.cancel(db),
  bootstrapRollback: db => boot.rollbackBootstrap(db),
  running: () => ({ jobs: [...running.keys()] }),

  // ---- Claude Code connection ----
  claudeStatus: () => claudeAuth.status(),
  claudeLoginStart: (db, p) => claudeAuth.startLogin(db, { mode: ['claudeai', 'console', 'sso'].includes(p.mode) ? p.mode : 'claudeai', email: optS(p.email, 200) }),
  claudeLoginCode: (db, p) => claudeAuth.submitCode(S(p.code, 512)),
  claudeLoginCancel: db => claudeAuth.cancelLogin(db),
  claudeLogout: db => claudeAuth.logout(db),
  claudeVerify: async db => {
    const r = await runClaudeJob({ prompt: 'Use the curi MCP tool search_resources with query "agent-native reverse engineering". Reply with only the id of the top result.', allowedTools: ['mcp__curi__search_resources'], timeoutMs: 150000, maxTurns: 4, cwd: paths.backups });
    claudeAuth.recordVerification({ ...r, ok: r.status === 'COMPLETED' && /morluto\/rea/i.test(String(r.result)) });
    return { result: { status: r.status, reason: r.reason ? String(r.reason).slice(0, 300) : null, answer: r.result ? String(r.result).slice(0, 200) : null, cost_usd: r.cost_usd ?? null }, status: await claudeAuth.status() };
  },

  // ---- Provider connections (secrets go to the Keychain, never back to the UI) ----
  connections: db => conns.listConnections(db),
  connectionSave: async (db, p) => { const r = await conns.saveCredential(db, S(p.provider, 40), S(p.secret, 8192)); if (p.provider === 'github') clearGithubTokenCache(); return r; },
  connectionTest: (db, p) => conns.testConnection(db, S(p.provider, 40)),
  connectionRemove: async (db, p) => { const r = await conns.removeCredential(db, S(p.provider, 40)); if (p.provider === 'github') clearGithubTokenCache(); return r; },
  secretSave: (db, p) => conns.saveNamedSecret(db, S(p.ref, 60), S(p.value, 8192)),
  secretRemove: (db, p) => conns.deleteNamedSecret(db, S(p.ref, 60)),

  // ---- Autonomy & policy ----
  policy: db => ({ consent: policy.currentConsent(db), matrix: policy.MATRIX, modes: policy.MODES, trusted: policy.trustedPublishers(db), version: policy.POLICY_VERSION }),
  policyGrant: async (db, p) => { const c = policy.grantMode(db, S(p.mode, 20)); const changed = await ops.reevaluateQueued(db); return { consent: c, requeued_for_approval: changed }; },
  policyRevoke: async db => { const c = policy.revoke(db); const changed = await ops.reevaluateQueued(db); return { consent: c, requeued_for_approval: changed }; },
  trustedSet: (db, p) => { if (!Array.isArray(p.publishers)) throw new Error('publishers must be a list'); return policy.setTrustedPublishers(db, p.publishers); },

  // ---- Operations queue ----
  ops: (db, p) => ops.listOps(db, { status: optS(p.status, 30), q: optS(p.q, 100), limit: I(p.limit, 200, 1, 1000) }),
  opGet: (db, p) => ops.getOp(db, S(p.id, 64)),
  opEnqueue: async (db, p) => {
    const op = await ops.enqueue(db, S(p.kind, 40), p.params && typeof p.params === 'object' ? p.params : {}, { actor: p.approved === true ? 'user-approved' : 'user' });
    kickWorker(db);
    return op;
  },
  opPreview: (db, p) => ops.preview(db, S(p.kind, 40), p.params && typeof p.params === 'object' ? p.params : {}),
  opApprove: (db, p) => { const r = ops.approve(db, S(p.id, 64)); kickWorker(db); return r; },
  opReject: (db, p) => ops.reject(db, S(p.id, 64)),
  opCancel: (db, p) => ops.cancel(db, S(p.id, 64)),
  opRetry: (db, p) => { const r = ops.retry(db, S(p.id, 64)); kickWorker(db); return r; },

  // ---- Integrations catalogue: presets, skills, MCP definitions, background agent ----
  presets: async db => {
    const pr = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'presets.json'), 'utf8'));
    const trusted = policy.trustedPublishers(db);
    const defs = new Map(db.prepare('SELECT name, enabled FROM mcp_definitions').all().map(d => [d.name, d]));
    return {
      mcp: await Promise.all(pr.mcp.map(async m => ({ ...m, trusted: trusted.includes(m.publisher), defined: defs.has(m.name), enabled: Boolean(defs.get(m.name)?.enabled), secrets_present: Object.fromEntries(await Promise.all(Object.entries(m.secret_env).map(async ([k, ref]) => [k, Boolean(await conns.credentialFor(ref))]))) }))),
      skills: pr.skills.map(s => { const name = path.basename(s.path); const marker = (() => { try { return JSON.parse(fs.readFileSync(path.join(skillTarget(name), '.curi-managed.json'), 'utf8')); } catch { return null; } })(); return { ...s, name, publisher: s.repo.split('/')[0], trusted: trusted.includes(s.repo.split('/')[0]), installed: Boolean(marker), commit: marker?.commit || null, exists_unmanaged: !marker && fs.existsSync(skillTarget(name)) }; }),
    };
  },
  mcpDefs: db => db.prepare('SELECT * FROM mcp_definitions ORDER BY name').all().map(d => ({ ...d, args: JSON.parse(d.args), env: JSON.parse(d.env), secret_env: JSON.parse(d.secret_env), launcher: d.transport === 'stdio' ? mcpLauncherSpec(d.name) : null })),
  mcpDefine: (db, p) => defineMcp(db, p),
  mcpUndefine: (db, p) => {
    const d = db.prepare('SELECT enabled FROM mcp_definitions WHERE name=?').get(S(p.name, 64));
    if (!d) throw new Error('Unknown definition.');
    if (d.enabled) throw new Error('Disable the server before deleting its definition.');
    db.prepare('DELETE FROM mcp_definitions WHERE name=?').run(p.name);
    return { removed: true };
  },
  agentStatus: () => agentStatus(),
  systemScan: db => getPref(db, 'last_system_scan', null),
  // App updates: compares with the latest GitHub Release of the configured repository. Downloads are
  // opened in the browser; the release must publish SHA256SUMS so the DMG can be checked after download.
  updateCheck: async db => {
    const repo = getPref(db, 'update_repo', null);
    const current = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')).version;
    if (!repo) return { current, status: 'not_configured', detail: 'No public releases repository is configured yet.' };
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'CURI', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) }).catch(e => ({ ok: false, status: 0, e }));
    if (!r.ok) return { current, status: r.status === 404 ? 'no_releases' : 'unreachable', detail: r.status === 404 ? 'The repository has no published releases yet.' : 'Couldn\'t reach GitHub.' };
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    const assets = (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    return { current, latest, status: cmp(latest, current) > 0 ? 'available' : 'up_to_date', url: j.html_url, published_at: j.published_at, notes: String(j.body || '').slice(0, 4000), assets, has_checksums: assets.some(a => /SHA256SUMS/i.test(a.name)) };
  },
  prefsAll: db => Object.fromEntries(db.prepare('SELECT key, value FROM user_preferences').all().map(r => [r.key, JSON.parse(r.value)])),
};

// ---- helpers used above ----
let workerBusy = false, workerPromise = Promise.resolve(), stopping = false;
export function kickWorker(db) {
  if (workerBusy || stopping) return;
  workerBusy = true;
  workerPromise = ops.drain(db, { max: 50 }).catch(() => {}).finally(() => { workerBusy = false; if (!stopping && db.isOpen && db.prepare("SELECT 1 FROM operations WHERE status='queued'").get()) setTimeout(() => kickWorker(db), 2500); });
}
// Shutdown: stop taking new work and wait for the current operation to reach its end.
export async function stopWorker() { stopping = true; await workerPromise; }

const MCP_NAME_RX = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ENV_RX = /^[A-Z_][A-Z0-9_]{0,63}$/;
const LAUNCHERS = ['npx', 'uvx', 'node', 'python3', 'docker', 'bunx', 'deno'];
function defineMcp(db, p) {
  const name = S(p.name, 41);
  if (!MCP_NAME_RX.test(name) || name === 'curi') throw new Error('Invalid name (lowercase letters, numbers and hyphens; "curi" is reserved).');
  const transport = ['stdio', 'http', 'sse'].includes(p.transport) ? p.transport : 'stdio';
  let command = null, args = [], url = null;
  if (transport === 'stdio') {
    command = S(p.command, 300);
    if (!(LAUNCHERS.includes(command) || path.isAbsolute(command))) throw new Error(`The command must be an absolute path or one of: ${LAUNCHERS.join(', ')}.`);
    args = Array.isArray(p.args) ? p.args.map(a => S(String(a), 500)) : [];
    if (args.length > 40) throw new Error('Too many arguments.');
  } else {
    url = S(p.url, 500);
    const u = new URL(url);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('Remote servers must use https.');
  }
  const env = {}, secret_env = {};
  for (const [k, v] of Object.entries(p.env || {})) { if (!ENV_RX.test(k)) throw new Error(`Invalid variable: ${k}`); if (/(key|token|secret|password)/i.test(k)) throw new Error(`"${k}" looks like a secret: use a credential from the system vault.`); env[k] = S(String(v), 500); }
  for (const [k, ref] of Object.entries(p.secret_env || {})) { if (!ENV_RX.test(k) || !/^(secret:[a-z0-9][a-z0-9._-]{0,48}|provider:(github|anthropic|openai|google))$/.test(ref)) throw new Error(`Invalid secret reference: ${k}`); secret_env[k] = ref; }
  const ts = now();
  const exists = db.prepare('SELECT enabled FROM mcp_definitions WHERE name=?').get(name);
  if (exists?.enabled) throw new Error('Disable the server before editing its definition.');
  db.prepare(`INSERT INTO mcp_definitions(name,transport,command,args,url,env,secret_env,publisher,resource_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
    ON CONFLICT(name) DO UPDATE SET transport=excluded.transport, command=excluded.command, args=excluded.args, url=excluded.url, env=excluded.env, secret_env=excluded.secret_env, publisher=excluded.publisher, resource_id=excluded.resource_id, updated_at=excluded.updated_at`)
    .run(name, transport, command, JSON.stringify(args), url, JSON.stringify(env), JSON.stringify(secret_env), optS(p.publisher, 40)?.toLowerCase() || null, optS(p.resource_id, 300) || null, ts, ts);
  return ACTIONS.mcpDefs(db).find(d => d.name === name);
}

export async function dispatch(db, action, params = {}) {
  const fn = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) throw Object.assign(new Error(`Unknown action: ${action}`), { status: 404 });
  if (params == null || typeof params !== 'object' || Array.isArray(params)) throw new Error('invalid params');
  return await fn(db, params);
}
