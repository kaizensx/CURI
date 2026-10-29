// Claude Bridge: plan / apply / rollback of CURI's own integration (one compact skill + one stdio MCP
// registration). Transactional: backups + checksums + manifest; idempotent re-apply; semantic rollback
// that never clobbers unrelated user settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeHome, claudeJsonPath, paths } from './paths.mjs';
import { now, tx } from './db.mjs';
import { audit } from './audit-log.mjs';
import { findClaudeBinary, sha256File } from './env.mjs';

const pexec = promisify(execFile);
export const POLICY_VERSION = 'curi-policy-1';
export const SKILL_NAME = 'curi-resource-router';
export const MCP_NAME = 'curi';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const q = p => (/[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);

// Prefer a stable launcher (e.g. /opt/homebrew/bin/node) over the versioned Cellar path that
// process.execPath resolves to, so a Node upgrade doesn't silently break the registration.
export function nodeBin() {
  if (process.env.CURI_NODE_BIN) return process.env.CURI_NODE_BIN;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'node');
    try { if (dir && fs.realpathSync(p) === fs.realpathSync(process.execPath)) return p; } catch {}
  }
  return process.execPath;
}
export function cliCommand() { return `${q(nodeBin())} ${q(paths.cliEntry)}`; }
export function mcpSpec() { return { command: nodeBin(), args: [paths.cliEntry, 'mcp'] }; }

export function renderSkill() {
  const tpl = fs.readFileSync(path.join(paths.skillTemplateDir, 'SKILL.md'), 'utf8');
  return tpl.replaceAll('{{CURI_CLI}}', cliCommand());
}

function skillDir() { return path.join(claudeHome(), 'skills', SKILL_NAME); }

function readClaudeJson() {
  try { return JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`~/.claude.json is unreadable: ${e.message}`); }
}

function sameMcp(entry) {
  const s = mcpSpec();
  return entry && entry.command === s.command && JSON.stringify(entry.args || []) === JSON.stringify(s.args);
}

// An entry written by an earlier CURI version: same CLI entry point, node launcher at another path.
// Also covers a move between the source checkout and the bundled app (different curi.mjs path).
function olderCuriMcp(entry) {
  const a = entry?.args || [];
  return Boolean(entry) && !sameMcp(entry) && /(^|\/)node$/.test(entry.command || '') && a.length === 2 && a[1] === 'mcp' && /(^|\/)core\/bin\/curi\.mjs$/.test(a[0]);
}

export function planBridgeInstall() {
  const content = renderSkill();
  const dir = skillDir();
  const skillFile = path.join(dir, 'SKILL.md');
  const actions = [];
  const conflicts = [];
  if (fs.existsSync(skillFile)) {
    const managed = fs.existsSync(path.join(dir, '.curi-managed.json'));
    const cur = fs.readFileSync(skillFile, 'utf8');
    if (!managed) conflicts.push({ action: 'skill.write', reason: `A skill not managed by CURI already exists in ${dir}; it won't be overwritten.` });
    else if (cur === content) actions.push({ id: 'skill.write', risk: 'LOCAL_FILE_WRITE', state: 'already-applied', path: skillFile });
    else actions.push({ id: 'skill.write', risk: 'LOCAL_FILE_WRITE', state: 'update', path: skillFile, before_sha: sha(cur), after_sha: sha(content), preview: content });
  } else actions.push({ id: 'skill.write', risk: 'LOCAL_FILE_WRITE', state: 'create', path: skillFile, after_sha: sha(content), bytes: content.length, preview: content });

  const cj = readClaudeJson();
  const existing = cj?.mcpServers?.[MCP_NAME];
  const bin = findClaudeBinary();
  const spec = mcpSpec();
  const via = bin ? `${q(bin)} mcp add --scope user ${MCP_NAME} -- ${q(spec.command)} ${spec.args.map(q).join(' ')}` : `atomic edit of ${claudeJsonPath()} (mcpServers.${MCP_NAME}): Claude CLI not found`;
  if (existing && sameMcp(existing)) actions.push({ id: 'mcp.register', risk: 'LOCAL_FILE_WRITE', state: 'already-applied', target: claudeJsonPath() });
  else if (olderCuriMcp(existing)) actions.push({ id: 'mcp.register', risk: 'LOCAL_FILE_WRITE', state: 'update', target: claudeJsonPath(), via, previous: { command: existing.command, args: existing.args }, entry: { type: 'stdio', ...spec }, exposes: 'updates the Node launcher of the existing CURI entry' });
  else if (existing) conflicts.push({ action: 'mcp.register', reason: `An MCP named "${MCP_NAME}" with a different configuration (${existing.command}) already exists; it won't be changed.` });
  else actions.push({ id: 'mcp.register', risk: 'LOCAL_FILE_WRITE', state: 'create', target: claudeJsonPath(), via, entry: { type: 'stdio', ...spec }, exposes: 'read-only MCP tools + record_discovery (PENDING_REVIEW) + request_install_plan (never runs anything)' });

  return {
    policy_version: POLICY_VERSION,
    claude_home: claudeHome(),
    claude_json: claudeJsonPath(),
    claude_binary: bin,
    actions, conflicts,
    untouched: ['~/.claude/CLAUDE.md (not modified: the skill handles routing)', 'settings.json', 'hooks', 'outras skills e MCP servers'],
  };
}

function backup(db, txId, p) {
  const existed = fs.existsSync(p);
  let backupPath = null;
  if (existed) {
    backupPath = path.join(paths.backups, `${txId}__${path.basename(p)}__${Date.now()}`);
    fs.copyFileSync(p, backupPath);
    fs.chmodSync(backupPath, 0o600);
  }
  db.prepare('INSERT INTO config_snapshots(tx_id,path,existed,sha_before,backup_path,created_at) VALUES (?,?,?,?,?,?)').run(txId, p, existed ? 1 : 0, existed ? sha256File(p) : null, backupPath, now());
}

function writeAtomic(p, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.curi-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, p);
}

async function registerMcp(spec = mcpSpec()) {
  const bin = findClaudeBinary();
  if (bin) {
    try {
      await pexec(bin, ['mcp', 'add', '--scope', 'user', MCP_NAME, '--', spec.command, ...spec.args], { timeout: 60000 });
      return { method: 'claude-cli' };
    } catch (e) {
      throw new Error(`claude mcp add failed: ${String(e.stderr || e.message).slice(0, 300)}`);
    }
  }
  const cj = readClaudeJson() || {};
  cj.mcpServers = { ...(cj.mcpServers || {}), [MCP_NAME]: { type: 'stdio', ...spec, env: {} } };
  writeAtomic(claudeJsonPath(), JSON.stringify(cj, null, 2), 0o600);
  return { method: 'json-edit' };
}

async function unregisterMcp() {
  const bin = findClaudeBinary();
  if (bin) {
    try { await pexec(bin, ['mcp', 'remove', '--scope', 'user', MCP_NAME], { timeout: 60000 }); return { method: 'claude-cli' }; }
    catch (e) { if (!/not found|No MCP server/i.test(String(e.stderr))) throw new Error(`claude mcp remove failed: ${String(e.stderr || e.message).slice(0, 300)}`); return { method: 'claude-cli', note: 'already absent' }; }
  }
  const cj = readClaudeJson();
  if (cj?.mcpServers?.[MCP_NAME]) { delete cj.mcpServers[MCP_NAME]; writeAtomic(claudeJsonPath(), JSON.stringify(cj, null, 2), 0o600); }
  return { method: 'json-edit' };
}

function otherMcpFingerprint() {
  const cj = readClaudeJson();
  const others = Object.fromEntries(Object.entries(cj?.mcpServers || {}).filter(([k]) => k !== MCP_NAME).sort());
  return sha(JSON.stringify(others));
}

export function recordApprovals(db, actionIds, { actor = 'user', decision = 'approved', details = null } = {}) {
  for (const a of actionIds) db.prepare('INSERT INTO approvals(action,risk_class,decision,actor,policy_version,details,created_at) VALUES (?,?,?,?,?,?,?)').run(a, 'LOCAL_FILE_WRITE', decision, actor, POLICY_VERSION, details ? JSON.stringify(details) : null, now());
}

export async function applyBridgeInstall(db, { approve = [], actor = 'user' } = {}) {
  const plan = planBridgeInstall();
  const todo = plan.actions.filter(a => a.state !== 'already-applied');
  const missing = todo.filter(a => !approve.includes(a.id)).map(a => a.id);
  if (missing.length) {
    recordApprovals(db, missing, { actor, decision: 'missing' });
    return { applied: false, reason: 'approval_required', missing_approvals: missing, plan };
  }
  if (!todo.length) {
    audit(db, actor, 'bridge.install.noop', null, { reason: 'already applied' });
    refreshInstalledInstances(db);
    return { applied: false, reason: 'already_applied', plan, conflicts: plan.conflicts };
  }
  recordApprovals(db, todo.map(a => a.id), { actor });
  const txId = `tx-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare('INSERT INTO transactions(id,kind,status,manifest,created_at) VALUES (?,?,?,?,?)').run(txId, 'bridge.install', 'pending', JSON.stringify({ plan: todo.map(({ preview, ...a }) => a) }), now());
  const ops = [];
  try {
    for (const a of todo) {
      if (a.id === 'skill.write') {
        backup(db, txId, a.path);
        const content = renderSkill();
        writeAtomic(a.path, content);
        const marker = { managed_by: 'curi', tx: txId, sha256: sha(content), policy_version: POLICY_VERSION, written_at: now() };
        writeAtomic(path.join(path.dirname(a.path), '.curi-managed.json'), JSON.stringify(marker, null, 2));
        ops.push({ id: a.id, path: a.path, sha_after: marker.sha256, created_dir: a.state === 'create' });
      }
      if (a.id === 'mcp.register') {
        backup(db, txId, claudeJsonPath());
        const fpBefore = otherMcpFingerprint();
        if (a.state === 'update') await unregisterMcp();
        const r = await registerMcp();
        const fpAfter = otherMcpFingerprint();
        if (fpBefore !== fpAfter) throw new Error('Other MCP entries changed during registration; aborted.');
        ops.push({ id: a.id, method: r.method, others_fingerprint: fpBefore, previous: a.state === 'update' ? a.previous : null });
      }
    }
    db.prepare('UPDATE transactions SET status=?, manifest=?, committed_at=? WHERE id=?').run('committed', JSON.stringify({ ops }), now(), txId);
    audit(db, actor, 'bridge.install', txId, { ops });
    refreshInstalledInstances(db);
    return { applied: true, tx: txId, ops, conflicts: plan.conflicts };
  } catch (e) {
    db.prepare('UPDATE transactions SET status=?, manifest=? WHERE id=?').run('failed', JSON.stringify({ ops, error: e.message }), txId);
    audit(db, actor, 'bridge.install.failed', txId, { error: e.message, ops });
    const rb = await rollback(db, txId, { actor: 'system', partialOps: ops });
    return { applied: false, reason: 'failed', error: e.message, tx: txId, compensation: rb };
  }
}

export async function rollback(db, txId, { actor = 'user', partialOps = null } = {}) {
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(txId);
  if (!t) throw new Error(`Unknown transaction: ${txId}`);
  if (t.status === 'rolled_back') return { tx: txId, status: 'already_rolled_back' };
  const ops = partialOps || JSON.parse(t.manifest || '{}').ops || [];
  const results = [];
  for (const op of [...ops].reverse()) {
    if (op.id === 'skill.write') {
      const cur = sha256File(op.path);
      if (cur && cur !== op.sha_after) { results.push({ id: op.id, ok: false, reason: 'drift: SKILL.md was edited outside CURI; not removed (backup available)' }); continue; }
      const snap = db.prepare('SELECT * FROM config_snapshots WHERE tx_id=? AND path=?').get(txId, op.path);
      if (snap?.existed && snap.backup_path) { fs.copyFileSync(snap.backup_path, op.path); results.push({ id: op.id, ok: true, action: 'restored previous version' }); }
      else { fs.rmSync(path.dirname(op.path), { recursive: true, force: true }); results.push({ id: op.id, ok: true, action: 'removed' }); }
    }
    if (op.id === 'mcp.register') {
      const cj = readClaudeJson();
      const entry = cj?.mcpServers?.[MCP_NAME];
      if (entry && !sameMcp(entry) && !(op.previous && entry.command === op.previous.command)) { results.push({ id: op.id, ok: false, reason: 'drift: MCP entry changed outside CURI; not removed' }); continue; }
      const fpBefore = otherMcpFingerprint();
      const r = await unregisterMcp();
      if (op.previous) await registerMcp(op.previous);
      const preserved = otherMcpFingerprint() === fpBefore;
      results.push({ id: op.id, ok: true, action: op.previous ? 'restored previous entry' : 'unregistered', method: r.method, unrelated_mcp_preserved: preserved });
    }
  }
  const ok = results.every(r => r.ok);
  tx(db, () => {
    db.prepare('UPDATE transactions SET status=?, rolled_back_at=? WHERE id=?').run(ok ? 'rolled_back' : 'rollback_partial', now(), txId);
    audit(db, actor, 'bridge.rollback', txId, { results });
  });
  refreshInstalledInstances(db);
  return { tx: txId, status: ok ? 'rolled_back' : 'rollback_partial', results };
}

// Observes actual state (not intended state) and records it.
export function refreshInstalledInstances(db) {
  const dir = skillDir();
  const file = path.join(dir, 'SKILL.md');
  const markerPath = path.join(dir, '.curi-managed.json');
  const ts = now();
  const rows = [];
  if (fs.existsSync(file)) {
    const marker = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf8')) : null;
    const cur = sha256File(file);
    rows.push({ name: SKILL_NAME, kind: 'skill', scope: 'user', path: file, managed: marker ? 1 : 0, checksum: cur, health: marker && marker.sha256 === cur ? 'files-ok' : 'drift', details: { expected: marker?.sha256 ?? null } });
  }
  const entry = readClaudeJson()?.mcpServers?.[MCP_NAME];
  if (entry) rows.push({ name: MCP_NAME, kind: 'mcp', scope: 'user', path: claudeJsonPath(), managed: 1, checksum: sha(JSON.stringify(entry)), health: sameMcp(entry) ? 'configured' : olderCuriMcp(entry) ? 'outdated' : 'drift', details: { command: entry.command, args: entry.args } });
  tx(db, () => {
    db.prepare("DELETE FROM installed_instances WHERE managed_by_curi=1 AND name IN (?,?)").run(SKILL_NAME, MCP_NAME);
    for (const r of rows) db.prepare('INSERT INTO installed_instances(name,kind,scope,path,managed_by_curi,checksum,health,details,observed_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,scope,name) DO UPDATE SET path=excluded.path, managed_by_curi=excluded.managed_by_curi, checksum=excluded.checksum, health=excluded.health, details=excluded.details, observed_at=excluded.observed_at')
      .run(r.name, r.kind, r.scope, r.path, r.managed, r.checksum, r.health, JSON.stringify(r.details), ts);
  });
  return rows;
}

export function driftReport(db) {
  const rows = refreshInstalledInstances(db);
  return { observed_at: now(), items: rows, drift: rows.filter(r => r.health === 'drift') };
}
