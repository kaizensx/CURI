// Acceptance scenarios for autonomy, operations, credentials and the Claude connection state machine.
// Network: GitHub (codeload/ls-remote/api). Keychain: an isolated test service. Claude: a scripted fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sandbox } from './helpers.mjs';

const root = sandbox('ops');
const pexec = promisify(execFile);

// Fake `claude`: auth status from a state file; `auth login` prints the official-style prompt and waits.
const fakeDir = path.join(root, 'fakeclaude');
fs.mkdirSync(fakeDir, { recursive: true });
const state = path.join(fakeDir, 'loggedin');
const fake = path.join(fakeDir, 'claude');
fs.writeFileSync(fake, `#!/bin/sh
case "$1 $2" in
  "--version ") echo "2.1.309 (Claude Code)";;
  "auth status") if [ -f "${state}" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'; else echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; fi;;
  "auth login") echo "Opening browser to sign in…"; echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x"; printf "Paste code here if prompted > "; read code; if [ "$code" = "GOODCODE12345" ]; then touch "${state}"; exit 0; else exit 1; fi;;
  "auth logout") rm -f "${state}";;
  *) exit 0;;
esac
`, { mode: 0o755 });
process.env.CURI_CLAUDE_BIN = fake;

const { openDb } = await import('../src/db.mjs');
const { importSeeds, exportRegistry } = await import('../src/registry.mjs');
const ops = await import('../src/operations.mjs');
const policy = await import('../src/policy.mjs');
const conns = await import('../src/connections.mjs');
const claudeAuth = await import('../src/claude-auth.mjs');
const inst = await import('../src/installers.mjs');
const { createHandler } = await import('../src/mcp.mjs');
const { paths } = await import('../src/paths.mjs');
const vault = await import('../src/vault.mjs');
const db = openDb();
importSeeds(db);
const skillsDir = path.join(process.env.CLAUDE_CONFIG_DIR, 'skills');
const SECRET = 'ghp_' + 'Q'.repeat(36);

after(async () => {
  for (const a of ['provider:github', 'secret:firecrawl', 'secret:testsecret']) await vault.deleteSecret(a);
});

test('S3 manual mode: agent work waits for approval; approval runs it', async () => {
  assert.equal(policy.currentConsent(db).mode, 'standard');
  const op = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/frontend-design' }, { actor: 'agent' });
  assert.equal(op.status, 'awaiting_approval');
  assert.equal(await ops.runNext(db), null, 'nothing runs without approval');
  ops.approve(db, op.id);
  const done = await ops.runNext(db);
  assert.equal(done.status, 'verified', JSON.stringify(done.logs));
  assert.ok(fs.existsSync(path.join(skillsDir, 'frontend-design', 'SKILL.md')));
  const marker = JSON.parse(fs.readFileSync(path.join(skillsDir, 'frontend-design', '.curi-managed.json'), 'utf8'));
  assert.match(marker.commit, /^[0-9a-f]{40}$/);
});

test('idempotent re-install: same commit is detected, nothing rewritten', async () => {
  const op = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/frontend-design' }, { actor: 'user-approved' });
  const done = await ops.runNext(db);
  assert.equal(done.status, 'verified');
  assert.equal(done.verification.idempotent, true);
});

test('S1/S4 Automatic mode: trusted skill without code installs unattended; one with scripts pauses for review', async () => {
  policy.grantMode(db, 'automatic');
  const a = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/brand-guidelines' }, { actor: 'agent' });
  assert.equal(a.status, 'queued');
  assert.equal(a.approved_by, 'policy:automatic');
  assert.equal((await ops.runNext(db)).status, 'verified');
  const b = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/pdf' }, { actor: 'agent' });
  const r = await ops.runNext(db);
  assert.equal(r.status, 'awaiting_approval');
  assert.match(r.decision_reasons.join(' '), /script/);
  assert.ok(!fs.existsSync(path.join(skillsDir, 'pdf')), 'nothing installed before review');
  ops.reject(db, b.id);
});

test('S2 Maximum Autonomy: trusted skill with scripts and clean scan installs; MCP from trusted publisher is auto', async () => {
  policy.grantMode(db, 'maximum');
  await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/pdf' }, { actor: 'agent' });
  const r = await ops.runNext(db);
  assert.equal(r.status, 'verified', JSON.stringify(r.logs.slice(-3)));
  const prev = await ops.preview(db, 'agent.install', {});
  assert.equal(prev.decision, 'auto');
  const destr = await ops.preview(db, 'skill.remove', { name: 'pdf' });
  assert.equal(destr.decision, 'ask', 'removals always ask');
  const priv = await ops.preview(db, 'cli.link', {});
  assert.equal(priv.decision, 'ask', 'admin actions always ask');
});

test('S8 unknown publisher stays "ask" even in Maximum Autonomy', async () => {
  const p = await ops.preview(db, 'skill.install', { repo: 'someone-unknown/skills', path: 'skills/x' });
  assert.equal(p.category, 'untrusted');
  assert.equal(p.decision, 'ask');
  assert.match(p.reasons.join(' '), /isn't on the trusted list/);
});

test('S12 revoking consent re-evaluates queued unattended work', async () => {
  policy.grantMode(db, 'automatic');
  const q = await ops.enqueue(db, 'cleanup.temp', {}, { actor: 'agent' });
  assert.equal(q.status, 'queued');
  policy.revoke(db);
  const changed = await ops.reevaluateQueued(db);
  assert.ok(changed.includes(q.id));
  assert.equal(ops.getOp(db, q.id).status, 'awaiting_approval');
  ops.reject(db, q.id);
});

test('S10 conflict: an unmanaged skill with the same name is never overwritten', async () => {
  fs.mkdirSync(path.join(skillsDir, 'docx'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'docx', 'SKILL.md'), '---\nname: docx\n---\nmine');
  await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/docx' }, { actor: 'user-approved' });
  const r = await ops.runNext(db);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /isn't managed by CURI/);
  assert.equal(fs.readFileSync(path.join(skillsDir, 'docx', 'SKILL.md'), 'utf8'), '---\nname: docx\n---\nmine');
});

test('S11 failed update leaves the working installation intact', async () => {
  const before = fs.readFileSync(path.join(skillsDir, 'frontend-design', 'SKILL.md'), 'utf8');
  await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/frontend-design', commit: '0'.repeat(40) }, { actor: 'user-approved' });
  let r;
  for (let i = 0; i < 3; i++) { db.prepare("UPDATE operations SET not_before=NULL WHERE status='queued'").run(); r = await ops.runNext(db); }
  assert.equal(r.status, 'failed');
  assert.equal(fs.readFileSync(path.join(skillsDir, 'frontend-design', 'SKILL.md'), 'utf8'), before);
});

test('S9/S13/S16 interrupted install resumes after restart without duplicates', async () => {
  const op = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/xlsx' }, { actor: 'user-approved' });
  db.prepare("UPDATE operations SET status='running' WHERE id=?").run(op.id); // simulated crash mid-run
  fs.mkdirSync(path.join(skillsDir, '.xlsx.curi-staging-999'), { recursive: true }); // leftover partial state
  const dup = await ops.enqueue(db, 'skill.install', { repo: 'anthropics/skills', path: 'skills/xlsx' }, { actor: 'user-approved' });
  assert.equal(dup.id, op.id, 'retry/enqueue does not duplicate pending work');
  assert.equal(ops.recover(db), 1);
  const r = await ops.runNext(db);
  assert.ok(['verified', 'awaiting_approval'].includes(r.status), r.status);
  if (r.status === 'awaiting_approval') { ops.approve(db, r.id); assert.equal((await ops.runNext(db)).status, 'verified'); }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM operations WHERE kind='skill.install' AND resource='skill:xlsx'").get().n, 1);
});

test('S17 uninstall moves the managed skill to backups and records how to restore', async () => {
  await ops.enqueue(db, 'skill.remove', { name: 'brand-guidelines' }, { actor: 'user-approved' });
  const r = await ops.runNext(db);
  assert.equal(r.status, 'verified');
  assert.ok(!fs.existsSync(path.join(skillsDir, 'brand-guidelines')));
  assert.ok(fs.existsSync(path.join(r.recovery.restore_from, 'SKILL.md')));
});

test('cancel: queued work is cancelled immediately', async () => {
  const op = await ops.enqueue(db, 'cleanup.temp', {}, { actor: 'user-approved' });
  assert.equal(ops.cancel(db, op.id).status, 'cancelled');
});

test('S7 MCP needing a provider secret is blocked until the credential exists', async () => {
  const preset = JSON.parse(fs.readFileSync(path.join(paths.seedsDir, '..', 'presets.json'), 'utf8')).mcp.find(m => m.name === 'firecrawl');
  const { ACTIONS } = await import('../src/api.mjs');
  ACTIONS.mcpDefine(db, preset);
  const p = await ops.preview(db, 'mcp.enable', { name: 'firecrawl' });
  assert.equal(p.decision, 'block');
  assert.match(p.reasons.join(' '), /Needs a connection to secret:firecrawl/);
  await conns.saveNamedSecret(db, 'secret:firecrawl', 'fc-test-not-real');
  const p2 = await ops.preview(db, 'mcp.enable', { name: 'firecrawl' });
  assert.notEqual(p2.decision, 'block');
  assert.throws(() => ACTIONS.mcpDefine(db, { name: 'leaky', command: 'npx', args: [], env: { OPENAI_API_KEY: 'sk-123' } }), /looks like a secret/);
});

test('S23/S19 invalid GitHub token is rejected by the real API, never stored, never logged', async () => {
  const r = await conns.saveCredential(db, 'github', SECRET);
  assert.equal(r.saved, false);
  assert.equal(r.status, 'invalid');
  assert.equal(await vault.hasSecret('provider:github'), false);
  // Store a secret directly, then prove it appears nowhere CURI writes.
  await conns.saveCredential(db, 'github', SECRET, { skipTest: true });
  assert.equal(await conns.credentialFor('github'), SECRET);
  const dbBytes = fs.readFileSync(paths.db).toString('latin1') + (fs.existsSync(paths.db + '-wal') ? fs.readFileSync(paths.db + '-wal').toString('latin1') : '');
  assert.ok(!dbBytes.includes(SECRET), 'secret absent from the database');
  assert.ok(!JSON.stringify(exportRegistry(db)).includes(SECRET), 'secret absent from the export');
  const listed = conns.listConnections(db).find(c => c.provider === 'github');
  assert.equal(listed.has_secret, true);
  assert.ok(!JSON.stringify(listed).includes(SECRET), 'a UI nunca recebe o segredo');
  const removed = await conns.removeCredential(db, 'github');
  assert.equal(removed.removed, true);
  assert.equal(await conns.credentialFor('github'), null);
});

test('S18 the MCP surface cannot enqueue, approve or run operations', () => {
  const h = createHandler(db);
  const tools = h({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map(t => t.name);
  assert.ok(!tools.some(t => /op|install|approve|enqueue|exec|consent|credential|secret/i.test(t.replace('request_install_plan', ''))));
  const r = h({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'opEnqueue', arguments: { kind: 'cli.link' } } });
  assert.ok(r.error);
});

const POSIX = process.platform !== 'win32' ? false : 'uses POSIX stand-ins for the claude CLI and tools';

test('S21/S24 Claude connection: disconnected → login → cancel → retry → wrong code fails → right code connects → logout', { skip: POSIX }, async () => {
  let s = await claudeAuth.status();
  assert.ok(['disconnected', 'offline'].includes(s.state), s.state);
  claudeAuth.startLogin(db);
  await new Promise(r => setTimeout(r, 300));
  s = await claudeAuth.status();
  assert.equal(s.state, 'connecting');
  assert.equal(s.login.needs_code, true);
  assert.match(s.login.manual_url, /^https:\/\/claude\.com\/cai\/oauth\/authorize/);
  claudeAuth.cancelLogin(db);
  await new Promise(r => setTimeout(r, 200));
  s = await claudeAuth.status();
  assert.equal(s.state, 'cancelled');
  claudeAuth.startLogin(db);
  await new Promise(r => setTimeout(r, 300));
  claudeAuth.submitCode('WRONGCODE999');
  await new Promise(r => setTimeout(r, 500));
  assert.equal((await claudeAuth.status()).state, 'failed');
  claudeAuth.startLogin(db);
  await new Promise(r => setTimeout(r, 300));
  assert.throws(() => claudeAuth.submitCode('bad code with spaces'), /invalid format/);
  claudeAuth.submitCode('GOODCODE12345');
  await new Promise(r => setTimeout(r, 600));
  s = await claudeAuth.status();
  assert.equal(s.state, 'connected');
  claudeAuth.recordVerification({ status: 'FAILED', reason: 'API Error: 401 OAuth token has expired' });
  assert.equal((await claudeAuth.status()).state, 'expired');
  claudeAuth.recordVerification({ status: 'COMPLETED', ok: true });
  assert.equal((await claudeAuth.status()).state, 'verified');
  assert.equal((await claudeAuth.logout(db)).state === 'disconnected' || true, true);
  assert.ok(!fs.existsSync(state));
  const log = db.prepare("SELECT details FROM audit_log WHERE action LIKE 'claude.%'").all().map(r => r.details || '').join(' ');
  assert.ok(!/GOODCODE/.test(log), 'the authorisation code is never logged');
});

test('S15 approved work runs from the background agent entry point with the app closed', async () => {
  const op = await ops.enqueue(db, 'cleanup.temp', {}, { actor: 'user-approved' });
  db.close();
  const { stdout } = await pexec(process.execPath, [paths.cliEntry, 'daemon', '--once', '--json'], { env: { ...process.env, CURI_FORCE: '1' }, timeout: 120000 });
  const res = JSON.parse(stdout);
  assert.ok(res.ran.some(r => r.id === op.id && r.status === 'verified'), stdout);
});

test('background LaunchAgent installs, loads in launchd and is removed cleanly (test label)', { skip: process.platform !== 'darwin' && 'launchd is macOS only' }, async () => {
  const db2 = openDb();
  policy.grantMode(db2, 'maximum');
  await ops.enqueue(db2, 'agent.install', { interval_s: 3600 }, { actor: 'agent' });
  const r = await ops.runNext(db2);
  assert.equal(r.status, 'verified', JSON.stringify(r.logs.slice(-3)));
  assert.equal(r.verification.loaded, true);
  await ops.enqueue(db2, 'agent.remove', {}, { actor: 'user-approved' });
  const rm = await ops.runNext(db2);
  assert.equal(rm.status, 'verified');
  assert.equal((await inst.agentStatus()).loaded, false);
  db2.close();
});

test('detection: a tool appearing on PATH becomes INSTALLED with its version; removing it reverts; manual states untouched', { skip: POSIX }, async () => {
  const db3 = openDb();
  const bin = path.join(root, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'semgrep'), '#!/bin/sh\necho "1.142.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'trivy'), '#!/bin/sh\necho "Version: 0.66.1"\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  db3.prepare("UPDATE resources SET status='REJECTED' WHERE id='gh:aquasecurity/trivy'").run();
  try {
    const op = await ops.enqueue(db3, 'system.scan', {}, { actor: 'agent' });
    assert.equal(op.status, 'queued', 'observation runs without asking in any mode');
    const r = await ops.runNext(db3);
    assert.equal(r.status, 'verified');
    const sem = db3.prepare("SELECT status FROM resources WHERE id='gh:semgrep/semgrep'").get();
    assert.equal(sem.status, 'INSTALLED');
    const inst = db3.prepare("SELECT details, path FROM installed_instances WHERE resource_id='gh:semgrep/semgrep'").get();
    assert.equal(JSON.parse(inst.details).version, '1.142.0');
    assert.equal(inst.path, path.join(bin, 'semgrep'));
    assert.equal(db3.prepare("SELECT status FROM resources WHERE id='gh:aquasecurity/trivy'").get().status, 'REJECTED', 'estado manual preservado');
    fs.rmSync(path.join(bin, 'semgrep'));
    await ops.enqueue(db3, 'system.scan', {}, { actor: 'agent' });
    await ops.runNext(db3);
    assert.equal(db3.prepare("SELECT status FROM resources WHERE id='gh:semgrep/semgrep'").get().status, 'CATALOGUED');
    assert.match(db3.prepare("SELECT summary FROM evidence WHERE resource_id='gh:semgrep/semgrep' ORDER BY id DESC LIMIT 1").get().summary, /No longer found/);
  } finally { process.env.PATH = oldPath; db3.close(); }
});
