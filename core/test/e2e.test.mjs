// End-to-end with the real Claude Code CLI, against an isolated CLAUDE_CONFIG_DIR (never the user's profile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.mjs';

sandbox('e2e', { realClaude: true });
const { findClaudeBinary, mcpHealth } = await import('../src/env.mjs');
const bin = findClaudeBinary();

test('T01/T07/T15/T16 real Claude CLI: bootstrap → READY → live MCP health → rollback', { skip: !bin && 'Claude Code CLI not found', timeout: 240000 }, async () => {
  const { openDb } = await import('../src/db.mjs');
  const boot = await import('../src/bootstrap.mjs');
  const db = openDb();
  let st = await boot.advance(db);
  assert.equal(st.state, 'APPROVAL_REQUIRED');
  st = await boot.advance(db, { decisions: { approve: ['skill.write', 'mcp.register'] } });
  const v = st.data.completed['WP6-verify'].evidence;
  assert.equal(st.state, 'READY', JSON.stringify(v));
  const receipt = JSON.parse(fs.readFileSync(v.receipt_file, 'utf8'));
  const health = receipt.checks.find(c => c.id === 'bridge.mcp_health_via_claude');
  assert.equal(health.status, 'pass');
  assert.equal(health.evidence.server.healthy, true);
  assert.ok(fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')));

  const rb = await boot.rollbackBootstrap(db);
  assert.equal(rb.rollback.status, 'rolled_back', JSON.stringify(rb.rollback));
  const after = await mcpHealth(bin);
  assert.ok(!after.servers.some(s => s.name === 'curi'));
  assert.ok(!fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'curi-resource-router')));
  db.close();
});

test('S5 approved MCP server (Context7) is registered through the CURI launcher and Claude Code connects to it', { skip: !bin && 'Claude Code CLI not found', timeout: 300000 }, async () => {
  const { openDb } = await import('../src/db.mjs');
  const ops = await import('../src/operations.mjs');
  const policy = await import('../src/policy.mjs');
  const { ACTIONS } = await import('../src/api.mjs');
  const { mcpLauncherSpec } = await import('../src/installers.mjs');
  const db = openDb();
  const preset = JSON.parse(fs.readFileSync(new URL('../data/presets.json', import.meta.url), 'utf8')).mcp.find(m => m.name === 'context7');
  ACTIONS.mcpDefine(db, preset);
  policy.grantMode(db, 'maximum');
  const op = await ops.enqueue(db, 'mcp.enable', { name: 'context7' }, { actor: 'agent' });
  assert.equal(op.status, 'queued', 'trusted publisher + Maximum autonomy = no prompt');
  const r = await ops.runNext(db);
  const entry = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8')).mcpServers.context7;
  assert.deepEqual(entry.args, mcpLauncherSpec('context7').args, 'Claude starts the CURI launcher, not the package directly');
  assert.equal(r.verification.listed, true);
  assert.equal(r.status, 'verified', JSON.stringify(r.verification));
  await ops.enqueue(db, 'mcp.disable', { name: 'context7' }, { actor: 'user-approved' });
  assert.equal((await ops.runNext(db)).status, 'verified');
  db.close();
});
