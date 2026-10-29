// CURI 3.2: inspection parsing, resource kinds/options, agent relevance, multi-agent detection,
// Claude Code plugin lifecycle (scripted fake CLI), autonomy categories and maintenance decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandbox } from './helpers.mjs';

const root = sandbox('v32');
process.env.CODEX_HOME = path.join(root, 'codex');
process.env.CURI_NO_STARTUP_SCAN = '1';

// Scripted Claude CLI: `plugin list --json`, `plugin install/enable/disable/uninstall`, `mcp list`.
const fakeDir = path.join(root, 'fakeclaude');
fs.mkdirSync(fakeDir, { recursive: true });
const plugins = path.join(fakeDir, 'plugins.json');
fs.writeFileSync(plugins, '[]');
const fake = path.join(fakeDir, 'claude');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); const f = ${JSON.stringify(plugins)}; const a = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(f, 'utf8')); const save = l => fs.writeFileSync(f, JSON.stringify(l));
if (a[0] === '--version') { console.log('2.1.309 (Claude Code)'); process.exit(0); }
if (a[0] === 'mcp' && a[1] === 'list') { console.log('No MCP servers configured.'); process.exit(0); }
if (a[0] !== 'plugin') process.exit(1);
if (a[1] === 'list') { console.log(JSON.stringify(list)); process.exit(0); }
const name = a[2]; const id = name.includes('@') ? name : name + '@' + (a[a.indexOf('--marketplace') + 1] || 'x').split('/')[1];
const i = list.findIndex(p => p.id === id || p.id.split('@')[0] === name.split('@')[0]);
if (a[1] === 'install') { if (i < 0) list.push({ id, version: '2.0.0', scope: 'user', enabled: true, installPath: '/tmp/x' }); save(list); console.log('Installed ' + id); process.exit(0); }
if (i < 0) { console.error('not installed'); process.exit(1); }
if (a[1] === 'disable') list[i].enabled = false;
if (a[1] === 'enable') list[i].enabled = true;
if (a[1] === 'update') list[i].version = '2.1.0';
if (a[1] === 'uninstall') list.splice(i, 1);
save(list); process.exit(0);
`, { mode: 0o755 });
process.env.CURI_CLAUDE_BIN = fake;

const { openDb } = await import('../src/db.mjs');
const { importSeeds } = await import('../src/registry.mjs');
const { seedFacts, profileFor } = await import('../src/facts.mjs');
const inspect = await import('../src/inspect.mjs');
const { agentRelevance } = await import('../src/relevance.mjs');
const { deriveKind } = await import('../src/profile.mjs');
const { codexMcp } = await import('../src/agents.mjs');
const ops = await import('../src/operations.mjs');
await import('../src/installers.mjs');
const policy = await import('../src/policy.mjs');
const db = openDb();
importSeeds(db, undefined, { actor: 'test' });
const seeded = seedFacts(db);

test('every original seed ships inspected facts (bundled audit of the Master Specification)', () => {
  const total = db.prepare('SELECT COUNT(*) n FROM resources').get().n;
  assert.equal(seeded, total, 'one facts record per seed');
  const unreachable = db.prepare("SELECT COUNT(*) n FROM resource_facts WHERE json_extract(data, '$.reachable') = 0").get().n;
  assert.ok(unreachable <= 3, `at most a few unreachable sources (got ${unreachable})`);
});

test('inspection parsers: YAML block descriptions, README install commands, Codex MCP tables', () => {
  assert.equal(inspect.skillDesc('---\nname: x\ndescription: >-\n  Folded line one\n  and two.\nother: 1\n---\n'), 'Folded line one and two.');
  const c = inspect.installCommands('Run `brew install gitleaks` or `npx -y @playwright/mcp@0.0.83`; `uv tool install markitdown`; `claude mcp add x -- y`.');
  assert.deepEqual(c.brew, ['gitleaks']);
  assert.deepEqual(c.npx, ['@playwright/mcp@0.0.83']);
  assert.deepEqual(c.uv, ['markitdown']);
  const m = codexMcp('[mcp_servers.blender]\ncommand = "/opt/homebrew/bin/uvx"\nargs = ["mcp-for-blender"]\n\n[mcp_servers.blender.env]\nX = "1"\n\n[mcp_servers.horizonx]\nurl = "https://horizonx.so/api/mcp"\n');
  assert.deepEqual(m.map(x => x.name), ['blender', 'horizonx'], 'sub-tables are not servers');
  assert.equal(m[0].line, '/opt/homebrew/bin/uvx mcp-for-blender');
  assert.equal(m[1].url, 'https://horizonx.so/api/mcp');
});

test('resource kinds come from what the project ships, not from its name', () => {
  const r = { id: 'x', type: 'Framework', canonical_url: 'https://github.com/a/b', gh_full_name: 'a/b' };
  // A big framework with only contributor skills (.claude/skills) is not a skill pack.
  assert.equal(deriveKind(r, { source: 'github', layout: { skills: 30, skills_product: 0 }, packages: { npm: [{ name: 'b' }] } }), 'framework');
  assert.equal(deriveKind({ ...r, type: 'Skill' }, { source: 'github', layout: { skills: 5, skills_product: 5, marketplace: true } }), 'plugin');
  assert.equal(deriveKind({ ...r, type: 'Tool' }, { source: 'github', layout: {}, packages: { cask: [{ name: 'b' }] } }), 'app');
  assert.equal(deriveKind({ ...r, type: 'Tool' }, { source: 'github', layout: {}, packages: { npm: [{ name: 'b', bin: ['b'] }] } }), 'cli');
  assert.equal(deriveKind({ ...r, type: 'Registry' }, null), 'reference');
});

test('curated profiles: real install options per platform, readiness from the device', () => {
  const ctx = { managers: { brew: { available: true }, cask: { available: true } }, runtimes: { node: true } };
  const blender = profileFor(db, 'web:projects.blender.org/blender/blender', ctx);
  assert.equal(blender.kind, 'app');
  const mac = blender.options.find(o => o.manager === 'cask');
  assert.ok(mac && mac.name === 'blender');
  if (process.platform === 'darwin') assert.ok(mac.ready, 'cask ready when Homebrew is present');
  assert.ok(blender.options.some(o => o.manager === 'winget' && !o.supported_here) || process.platform === 'win32');
  const mcp = profileFor(db, 'gh:ahujasid/mcp-for-blender', { managers: {}, runtimes: {} });
  const opt = mcp.options.find(o => o.method === 'mcp');
  assert.deepEqual(opt.missing, ['uv'], 'missing prerequisite is reported, not hidden');
  assert.ok(opt.setup.length >= 1, 'manual Blender add-on steps are carried');
  const gsap = profileFor(db, 'gh:greensock/gsap', ctx);
  assert.equal(gsap.kind, 'library');
  assert.ok(gsap.options.every(o => o.shared), 'only the shared docs server for the agent; the library itself goes into projects');
  assert.deepEqual(gsap.project_use.map(p => p.command), ['npm install gsap']);
});

test('agent relevance keeps tools agents can reach and filters noise with a reason', () => {
  const ref = new Date('2026-10-28');
  const mcp = agentRelevance({ name: 'kicad-mcp', description: 'MCP server for KiCad PCB design', topics: ['mcp'], stars: 400, created_at: '2026-08-01', pushed_at: '2026-10-20', license: 'MIT' }, { ref });
  assert.equal(mcp.interface, 'mcp');
  assert.ok(mcp.score > 0.8 && !mcp.noise);
  assert.ok(mcp.domains.includes('CAD and fabrication'));
  for (const [name, description] of [['awesome-agents', 'A curated list of awesome AI agents'], ['llm-course', 'Course and roadmap to learn LLMs'], ['dotfiles', 'my dotfiles and setup'], ['x', '']]) {
    const r = agentRelevance({ name, description, topics: [], stars: 9000, created_at: '2024-01-01', pushed_at: '2026-10-01', license: 'MIT' }, { ref });
    assert.equal(r.score, 0);
    assert.ok(r.noise, `${name} filtered with a reason`);
  }
});

test('multi-agent detection: a Codex MCP entry is recognised as the catalogue resource it launches', async () => {
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), '[mcp_servers.blender]\ncommand = "uvx"\nargs = ["mcp-for-blender"]\n');
  const { scanSystem } = await import('../src/detect.mjs');
  const r = await scanSystem(db);
  const codex = r.agents.find(a => a.id === 'codex');
  assert.ok(codex.present && codex.mcp[0].matched);
  const m = r.matched.find(x => x.id === 'gh:ahujasid/mcp-for-blender');
  assert.ok(m, 'matched through the launched package name');
  assert.equal(m.state, 'configured');
  assert.equal(m.found[0].agent, 'codex');
  assert.equal(db.prepare('SELECT status FROM resources WHERE id=?').get('gh:ahujasid/mcp-for-blender').status, 'CONFIGURED');
  const { resourceView } = await import('../src/actions.mjs');
  const v = resourceView(db, 'gh:ahujasid/mcp-for-blender');
  assert.ok(v.actions.assist.some(a => a.type === 'reveal' && a.agent === 'codex'), 'Codex config is read-only: assisted management');
  assert.ok(v.actions.install.some(a => a.op?.kind === 'mcp.add'), 'can still be added to Claude Code');
});

// The Claude stand-ins are POSIX scripts; Windows can't execute them without a .cmd shim.
const POSIX = process.platform !== 'win32' ? false : 'uses a POSIX stand-in for the claude CLI';

test('Claude Code plugin lifecycle through the official CLI, verified after every step', { skip: POSIX }, async () => {
  const run = async (kind, params) => { const op = await ops.enqueue(db, kind, params, { actor: 'user-approved' }); await ops.drain(db, { max: 3 }); return ops.getOp(db, op.id); };
  const inst = await run('plugin.install', { marketplace: 'twostraws/swiftui-agent-skill', plugin: 'swiftui-pro', resource_id: 'gh:twostraws/swiftui-agent-skill' });
  assert.equal(inst.status, 'verified', inst.error || '');
  assert.equal(inst.verification.plugin, 'swiftui-pro@swiftui-agent-skill');
  assert.ok(db.prepare("SELECT 1 FROM installed_instances WHERE kind='plugin' AND managed_by_curi=1 AND resource_id=?").get('gh:twostraws/swiftui-agent-skill'));
  const again = await run('plugin.install', { marketplace: 'twostraws/swiftui-agent-skill', plugin: 'swiftui-pro' });
  assert.ok(again.verification.already_installed, 'idempotent');
  assert.equal((await run('plugin.disable', { plugin: 'swiftui-pro@swiftui-agent-skill' })).verification.after.enabled, false);
  assert.equal((await run('plugin.enable', { plugin: 'swiftui-pro@swiftui-agent-skill' })).verification.after.enabled, true);
  assert.equal((await run('plugin.update', { plugin: 'swiftui-pro@swiftui-agent-skill' })).verification.after.version, '2.1.0');
  const un = await run('plugin.uninstall', { plugin: 'swiftui-pro@swiftui-agent-skill' });
  assert.equal(un.status, 'verified');
  assert.equal(JSON.parse(fs.readFileSync(plugins, 'utf8')).length, 0);
});

test('autonomy: verified-provenance packages are automatic only in Maximum; removals always ask', async () => {
  const plan = { category: 'package_trusted', publisher: 'gitleaks', verifiedSource: true };
  policy.grantMode(db, 'automatic', { actor: 'test' });
  assert.equal(policy.evaluate(db, plan).decision, 'ask');
  assert.equal(policy.evaluate(db, plan).category, 'package_verified');
  policy.grantMode(db, 'maximum', { actor: 'test' });
  assert.equal(policy.evaluate(db, plan).decision, 'auto');
  assert.equal(policy.evaluate(db, { ...plan, verifiedSource: false }).category, 'untrusted');
  assert.equal(policy.evaluate(db, { category: 'destructive' }).decision, 'ask');
  assert.equal(policy.evaluate(db, { category: 'maintenance' }).decision, 'auto');
  policy.revoke(db, { actor: 'test' });
});

test('maintenance: repairs run alone when the mode covers them, otherwise become suggestions', async () => {
  const { maintenancePass } = await import('../src/maintenance.mjs');
  const { setPref } = await import('../src/db.mjs');
  for (const k of ['auto_scan_hours', 'auto_verify_hours', 'auto_update_hours', 'auto_package_update_hours']) setPref(db, k, 0);
  setPref(db, 'pause_on_battery', false);
  db.prepare("INSERT INTO mcp_definitions(name,transport,command,args,env,secret_env,publisher,enabled,created_at,updated_at) VALUES ('ghost','stdio','npx','[]','{}','{}','upstash',1,'x','x')").run();
  const std = await maintenancePass(db, { force: true });
  assert.ok(std.suggestions.some(s => s.kind === 'mcp.enable' && s.params.name === 'ghost'), 'Standard: suggestion, nothing queued');
  assert.ok(!std.queued.some(q => q.kind === 'mcp.enable'));
  policy.grantMode(db, 'automatic', { actor: 'test' });
  const auto = await maintenancePass(db, { force: true });
  assert.ok(auto.queued.some(q => q.kind === 'mcp.enable' && q.params.repair), 'Automatic: repair queued without asking');
  policy.revoke(db, { actor: 'test' });
  for (const o of ops.listOps(db, {})) if (['queued', 'awaiting_approval'].includes(o.status)) ops.cancel(db, o.id);
});

test('capability map and decision comparison are grounded in the registry and the device', async () => {
  const { capabilityMap, compareDecision } = await import('../src/capabilities.mjs');
  const m = capabilityMap(db);
  assert.ok(m.summary.agent_total > 30);
  const blender = m.capabilities.find(c => c.id === 'blender-control');
  assert.equal(blender.status, 'ready', 'configured in Codex counts as available to an agent');
  const c = compareDecision(db, ['gh:microsoft/playwright-mcp', 'gh:chromedevtools/chrome-devtools-mcp'], { useCase: 'test the site in the browser' });
  assert.equal(c.items.length, 2);
  for (const it of c.items) { assert.ok(it.install.text); assert.ok(Array.isArray(it.security)); assert.ok(it.license); }
  assert.ok(c.items.some(i => i.unique.length), 'states what only one of them offers');
  assert.ok(!('score' in c.items[0]), 'no arbitrary total score');
});

test('native shell flag survives the token clean-up (sidebar clears the macOS window buttons)', () => {
  const ui = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'lib', 'ui.js'), 'utf8');
  const keep = ui.indexOf("sessionStorage.setItem('curi-native', '1')"), wipe = ui.indexOf('history.replaceState');
  assert.ok(keep > 0 && keep < wipe, 'the native flag is stored before the address is rewritten');
});

test('projects: the documented command becomes the right one for the project, and is verified in the manifest', async () => {
  const { describeProject, planProjectCommand, verifyInProject } = await import('../src/projects.mjs');
  const dir = path.join(root, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { gsap: '^3' } }));
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  const p = describeProject(dir);
  assert.equal(p.ecosystems[0].manager, 'pnpm');
  assert.deepEqual(planProjectCommand('npm install -D msw', p), { cmd: 'pnpm', args: ['add', '-D', 'msw'], verify: { js: ['msw'] }, ecosystem: 'js' });
  assert.equal(planProjectCommand('npx shadcn@latest add @react-bits/<component>', p).needs, 'component');
  assert.deepEqual(planProjectCommand('npx shadcn@latest add @react-bits/<component>', p, { component: 'blur-text' }).args, ['--yes', 'shadcn@latest', 'add', '@react-bits/blur-text', '--yes']);
  assert.ok(planProjectCommand('pip install librosa', p).error, 'a JS project refuses pip');
  assert.equal(verifyInProject(p, { js: ['gsap'] }), true);
  assert.equal(verifyInProject(p, { js: ['msw'] }), false);
});

test('personal layer: favourites, collections, notes, own kind and command change what the app offers', async () => {
  const { setMark, collections } = await import('../src/marks.mjs');
  setMark(db, 'gh:greensock/gsap', { fav: true, collections: ['Animation'], notes: 'use on the site', command: 'pnpm add gsap' });
  assert.deepEqual(collections(db).find(c => c.name === 'Animation'), { name: 'Animation', n: 1 });
  const pf = profileFor(db, 'gh:greensock/gsap');
  assert.equal(pf.project_use[0].command, 'pnpm add gsap');
  setMark(db, 'gh:greensock/gsap', { kind: 'reference' });
  assert.equal(profileFor(db, 'gh:greensock/gsap').kind, 'reference');
  assert.throws(() => setMark(db, 'gh:greensock/gsap', { command: 'rm -rf /' }), /Unsupported command/);
  setMark(db, 'gh:greensock/gsap', { kind: null, fav: false, collections: [], notes: '', command: '' });
});
