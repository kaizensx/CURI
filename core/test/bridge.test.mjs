import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.mjs';

sandbox('bridge');
const CJ = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
// Pre-existing user environment (T02): another MCP server, unrelated keys, an unrelated skill.
const userCj = { numStartups: 7, theme: 'dark', mcpServers: { rea: { command: '/opt/homebrew/bin/rea', args: ['mcp'], env: { HOPPER_LAUNCHER_PATH: '/x' } } }, projects: { '/p': { mcpServers: {} } } };
fs.writeFileSync(CJ, JSON.stringify(userCj, null, 2));
fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'my-own-skill'), { recursive: true });
fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'my-own-skill', 'SKILL.md'), '---\nname: my-own-skill\ndescription: mine\n---\nhello');

const { openDb } = await import('../src/db.mjs');
const bridge = await import('../src/bridge.mjs');
const boot = await import('../src/bootstrap.mjs');
const { inventory } = await import('../src/env.mjs');
const db = openDb();

const others = () => { const j = JSON.parse(fs.readFileSync(CJ, 'utf8')); delete j.mcpServers.curi; return j; };
const skillFile = path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', bridge.SKILL_NAME, 'SKILL.md');

test('inventory sees existing skills and MCP without exposing env values', () => {
  const inv = inventory();
  assert.ok(inv.skills.some(s => s.name === 'my-own-skill'));
  const rea = inv.mcp.find(m => m.name === 'rea');
  assert.deepEqual(rea.env_keys, ['HOPPER_LAUNCHER_PATH']);
  assert.ok(!JSON.stringify(inv).includes('/x"'));
});

test('T03/T13 bootstrap without approvals never writes to the Claude profile and is not READY', async () => {
  let st = await boot.advance(db);
  assert.equal(st.state, 'APPROVAL_REQUIRED');
  assert.ok(st.data.completed['WP2-snapshot'].evidence.files.some(f => f.path === CJ && f.existed));
  st = await boot.advance(db, { decisions: { approve: [] } });
  assert.equal(st.state, 'PARTIAL_READY');
  assert.ok(!fs.existsSync(skillFile));
  assert.deepEqual(JSON.parse(fs.readFileSync(CJ, 'utf8')), userCj);
});

test('T13 apply without specific approval is refused and audited', async () => {
  const r = await bridge.applyBridgeInstall(db, { approve: ['skill.write'] });
  assert.equal(r.applied, false);
  assert.deepEqual(r.missing_approvals, ['mcp.register']);
  assert.ok(!fs.existsSync(skillFile));
  assert.ok(db.prepare("SELECT 1 FROM approvals WHERE decision='missing' AND action='mcp.register'").get());
});

let txId;
test('T02 approved install merges without losing user config', async () => {
  const r = await bridge.applyBridgeInstall(db, { approve: ['skill.write', 'mcp.register'] });
  assert.equal(r.applied, true, JSON.stringify(r));
  txId = r.tx;
  assert.ok(fs.existsSync(skillFile));
  assert.match(fs.readFileSync(skillFile, 'utf8'), /curi\.mjs/);
  const after = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  assert.equal(after.mcpServers.curi.args.at(-1), 'mcp');
  assert.deepEqual(others(), userCj);
  assert.ok(fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'my-own-skill', 'SKILL.md')));
  const snaps = db.prepare('SELECT * FROM config_snapshots WHERE tx_id=?').all(txId);
  assert.ok(snaps.some(s => s.path === CJ && s.existed === 1 && fs.existsSync(s.backup_path)));
});

test('idempotent re-apply: no duplicate entries', async () => {
  const r = await bridge.applyBridgeInstall(db, { approve: ['skill.write', 'mcp.register'] });
  assert.equal(r.reason, 'already_applied');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE status='committed'").get().n, 1);
});

test('T06 external edit is detected as drift and rollback refuses to clobber it', async () => {
  const orig = fs.readFileSync(skillFile, 'utf8');
  fs.appendFileSync(skillFile, '\n<!-- user edit -->\n');
  assert.equal(bridge.driftReport(db).drift.length, 1);
  const plan = bridge.planBridgeInstall();
  assert.equal(plan.actions.find(a => a.id === 'skill.write').state, 'update');
  const rb = await bridge.rollback(db, txId);
  assert.equal(rb.status, 'rollback_partial');
  assert.ok(fs.existsSync(skillFile), 'a file edited by the user was not removed');
  fs.writeFileSync(skillFile, orig);
});

test('T16 rollback reverts managed changes exactly and preserves unrelated settings', async () => {
  db.prepare("UPDATE transactions SET status='committed' WHERE id=?").run(txId);
  // Unrelated change made by the user after install must survive rollback.
  const j = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  j.mcpServers.another = { command: 'x', args: [] };
  fs.writeFileSync(CJ, JSON.stringify(j, null, 2));
  const rb = await bridge.rollback(db, txId);
  assert.equal(rb.status, 'rolled_back', JSON.stringify(rb));
  assert.ok(!fs.existsSync(path.dirname(skillFile)));
  const after = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  assert.equal(after.mcpServers.curi, undefined);
  assert.deepEqual(after.mcpServers.another, { command: 'x', args: [] });
  assert.deepEqual(after.mcpServers.rea, userCj.mcpServers.rea);
  assert.equal(after.theme, 'dark');
});

test('unmanaged skill with the same name is a conflict, never overwritten', () => {
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, 'someone else\'s skill');
  const plan = bridge.planBridgeInstall();
  assert.ok(plan.conflicts.some(c => c.action === 'skill.write'));
  assert.ok(!plan.actions.some(a => a.id === 'skill.write'));
  fs.rmSync(path.dirname(skillFile), { recursive: true });
});

test('T05 crash mid-provisioning resumes from checkpoint without double-apply', async () => {
  const st = boot.getState(db);
  st.data.decisions = { approve: ['skill.write', 'mcp.register'] };
  delete st.data.completed['WP5-provision'];
  delete st.data.completed['WP6-verify'];
  db.prepare("UPDATE bootstrap SET state='PROVISIONING', data=? WHERE id=1").run(JSON.stringify(st.data));
  const before = db.prepare("SELECT COUNT(*) n FROM transactions WHERE kind='bridge.install' AND status='committed'").get().n;
  const rec = await boot.launchCheck(db);
  assert.equal(rec.recovered.recovered, true);
  const done = await boot.advance(db);
  assert.ok(['READY', 'PARTIAL_READY'].includes(done.state), done.state);
  // Simulate a second crash after provisioning: replay must not create another install transaction.
  db.prepare("UPDATE bootstrap SET state='PROVISIONING' WHERE id=1").run();
  await boot.launchCheck(db);
  await boot.advance(db);
  const after = db.prepare("SELECT COUNT(*) n FROM transactions WHERE kind='bridge.install' AND status='committed'").get().n;
  assert.equal(after, before + 1);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(CJ, 'utf8')).mcpServers).filter(k => k === 'curi').length, 1);
});

test('older CURI MCP entry is updated (not a conflict) and rollback restores it', async () => {
  const j = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  const prev = { type: 'stdio', command: '/usr/local/old/bin/node', args: bridge.mcpSpec().args, env: {} };
  j.mcpServers.curi = prev;
  fs.writeFileSync(CJ, JSON.stringify(j, null, 2));
  const plan = bridge.planBridgeInstall();
  assert.equal(plan.actions.find(a => a.id === 'mcp.register').state, 'update');
  assert.equal(plan.conflicts.length, 0);
  const r = await bridge.applyBridgeInstall(db, { approve: ['mcp.register', 'skill.write'] });
  assert.equal(r.applied, true, JSON.stringify(r));
  assert.equal(JSON.parse(fs.readFileSync(CJ, 'utf8')).mcpServers.curi.command, bridge.mcpSpec().command);
  const rb = await bridge.rollback(db, r.tx);
  assert.equal(rb.status, 'rolled_back', JSON.stringify(rb));
  assert.equal(JSON.parse(fs.readFileSync(CJ, 'utf8')).mcpServers.curi.command, prev.command);
  await bridge.applyBridgeInstall(db, { approve: ['mcp.register', 'skill.write'] });
});

test('entry from a relocated CURI (source checkout → app bundle) is an update, not a conflict', () => {
  const j = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  const saved = j.mcpServers.curi;
  j.mcpServers.curi = { type: 'stdio', command: '/opt/homebrew/bin/node', args: ['/Applications/Old.app/Contents/Resources/curi/core/bin/curi.mjs', 'mcp'], env: {} };
  fs.writeFileSync(CJ, JSON.stringify(j, null, 2));
  assert.equal(bridge.planBridgeInstall().actions.find(a => a.id === 'mcp.register').state, 'update');
  j.mcpServers.curi = { type: 'stdio', command: '/opt/homebrew/bin/node', args: ['/somewhere/else.mjs', 'mcp'], env: {} };
  fs.writeFileSync(CJ, JSON.stringify(j, null, 2));
  assert.ok(bridge.planBridgeInstall().conflicts.some(c => c.action === 'mcp.register'), 'entrada alheia continua a ser conflito');
  j.mcpServers.curi = saved;
  fs.writeFileSync(CJ, JSON.stringify(j, null, 2));
});

test('T22 routine launch does not re-run bootstrap', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM job_events').get().n;
  const r = await boot.launchCheck(db);
  assert.equal(r.needs_onboarding, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_events').get().n, before);
});
