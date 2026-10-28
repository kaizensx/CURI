// Operation handlers for the Library's real actions: system packages (Homebrew, npm, uv, pipx, Cargo,
// WinGet, Scoop, Flatpak), Claude Code plugins, MCP servers from a resource profile, and live
// re-inspection. Every run verifies the observed result afterwards; nothing is reported as done
// because a command exited 0.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerHandler, permanent } from './operations.mjs';
import { MANAGERS, packageManagers, childEnv, which, OS } from './platform.mjs';
import { findClaudeBinary, mcpHealth } from './env.mjs';
import { now } from './db.mjs';
import { profileFor, inspectResource } from './facts.mjs';
import { claudeMcp, otherEntries, mcpLauncherSpec } from './installers.mjs';
import { claudeJsonPath } from './paths.mjs';
import fs from 'node:fs';

const pexec = promisify(execFile);
const NAME_RX = /^[@A-Za-z0-9][A-Za-z0-9@._/+-]{0,120}$/;
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ownerOf = (db, id) => db.prepare('SELECT gh_full_name FROM resources WHERE id=?').get(id || '')?.gh_full_name?.split('/')[0] || null;

// Streams a command's output into the operation log; honours cancellation between output chunks.
function stream(cmd, args, ctx, { timeoutMs = 30 * 60e3, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...childEnv(), HOMEBREW_NO_ENV_HINTS: '1', NONINTERACTIVE: '1', CI: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = '', lastLog = 0;
    const onData = d => {
      tail = (tail + d).slice(-8000);
      const line = String(d).split(/\r?\n/).map(x => x.trim()).filter(Boolean).pop();
      if (line && Date.now() - lastLog > 400) { ctx.log(line.slice(0, 200)); lastLog = Date.now(); }
      if (ctx.cancelled()) child.kill('SIGTERM');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(tail) : reject(Object.assign(new Error(`${cmd} terminou com código ${code}: ${tail.split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 400)}`), { tail })); });
  });
}

// ---------- system packages ----------
async function managerFor(p) {
  const m = MANAGERS[p.manager];
  if (!m) throw new Error('Gestor de pacotes não suportado.');
  if (!m.os.includes(OS)) throw new Error(`${m.label} não existe neste sistema.`);
  if (!NAME_RX.test(p.name || '')) throw new Error('Nome de pacote inválido.');
  if (p.from && !/^git\+https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(\.git)?$/.test(p.from)) throw new Error('Origem inválida.');
  const bin = which(m.bin);
  return { m, bin };
}
function recordPackage(db, p, version, managed) {
  db.prepare(`INSERT INTO installed_instances(resource_id,name,kind,scope,path,managed_by_curi,checksum,health,details,observed_at) VALUES (?,?,?,?,?,?,NULL,?,?,?)
    ON CONFLICT(kind,scope,name) DO UPDATE SET resource_id=COALESCE(excluded.resource_id, installed_instances.resource_id), managed_by_curi=excluded.managed_by_curi, health=excluded.health, details=excluded.details, observed_at=excluded.observed_at`)
    .run(p.resource_id || null, p.name, `package:${p.manager}`, 'user', null, managed ? 1 : 0, 'verified', JSON.stringify({ version, manager: p.manager }), now());
}

registerHandler('package.install', {
  async plan(db, p) {
    const { m } = await managerFor(p);
    const owner = p.publisher || ownerOf(db, p.resource_id);
    return { category: 'package_trusted', publisher: owner, verifiedSource: Boolean(p.resource_id && p.evidence && p.evidence !== 'documented'), resource: `${p.manager}:${p.name}`, lockKey: `pkg:${p.manager}:${p.name}`, source: `${m.label} · ${p.name}${p.version ? ` ${p.version}` : ''}` };
  },
  async run(db, p, ctx) {
    const { m, bin } = await managerFor(p);
    if (!bin) throw permanent(`${m.label} não está instalado neste dispositivo.`, { action: `Instalar ${m.label} primeiro` });
    ctx.stage(`A verificar se ${p.name} já está instalado`, 0.05);
    const before = await m.list(bin);
    const key = ['uv', 'pipx'].includes(p.manager) ? p.name.toLowerCase() : p.name;
    if (before.has(key)) { recordPackage(db, p, before.get(key), false); ctx.log(`Já instalado (${before.get(key) || 'versão desconhecida'}).`); return { verified: true, verification: { already_installed: true, version: before.get(key) } }; }
    if (ctx.cancelled()) return { cancelled: true };
    const args = p.manager === 'uv' && p.from ? ['tool', 'install', p.name, '--from', p.from] : m.install(p.name, p.pin ? p.version : null);
    ctx.stage(`A instalar com ${m.label}: ${p.name}`, null);
    ctx.log(`$ ${m.bin} ${args.join(' ')}`);
    await stream(bin, args, ctx);
    if (ctx.cancelled()) return { cancelled: true };
    ctx.stage('A verificar a instalação', 0.92);
    const after = await m.list(bin);
    const ok = after.has(key);
    if (ok) recordPackage(db, p, after.get(key), true);
    return { verified: ok, verification: { listed_by_manager: ok, version: after.get(key) || null }, recovery: { remove: `package.remove ${p.manager} ${p.name}` } };
  },
});

registerHandler('package.upgrade', {
  async plan(db, p) { await managerFor(p); return { category: 'maintenance', publisher: p.publisher || ownerOf(db, p.resource_id), resource: `${p.manager}:${p.name}`, lockKey: `pkg:${p.manager}:${p.name}`, source: MANAGERS[p.manager].label }; },
  async run(db, p, ctx) {
    const { m, bin } = await managerFor(p);
    if (!bin) throw permanent(`${m.label} não está instalado.`);
    const key = ['uv', 'pipx'].includes(p.manager) ? p.name.toLowerCase() : p.name;
    const before = (await m.list(bin)).get(key);
    if (before === undefined) throw permanent(`${p.name} não está instalado com ${m.label}.`);
    ctx.stage(`A atualizar ${p.name} (${before || '?'})`, null);
    await stream(bin, m.upgrade(p.name), ctx);
    const after = (await m.list(bin)).get(key);
    recordPackage(db, p, after, Boolean(db.prepare('SELECT managed_by_curi FROM installed_instances WHERE kind=? AND name=?').get(`package:${p.manager}`, p.name)?.managed_by_curi));
    ctx.log(after === before ? `Já estava na versão mais recente (${after}).` : `${before} → ${after}`);
    return { verified: after !== undefined, verification: { before, after } };
  },
});

registerHandler('package.remove', {
  async plan(db, p) { await managerFor(p); return { category: 'destructive', resource: `${p.manager}:${p.name}`, lockKey: `pkg:${p.manager}:${p.name}`, source: MANAGERS[p.manager].label }; },
  async run(db, p, ctx) {
    const { m, bin } = await managerFor(p);
    if (!bin) throw permanent(`${m.label} não está instalado.`);
    const key = ['uv', 'pipx'].includes(p.manager) ? p.name.toLowerCase() : p.name;
    if (!(await m.list(bin)).has(key)) return { verified: true, verification: { already_absent: true } };
    ctx.stage(`A remover ${p.name} com ${m.label}`, null);
    await stream(bin, m.remove(p.name), ctx);
    const gone = !(await m.list(bin)).has(key);
    if (gone) db.prepare('DELETE FROM installed_instances WHERE kind=? AND name=?').run(`package:${p.manager}`, p.name);
    return { verified: gone, verification: { absent_from_manager: gone } };
  },
});

// ---------- Claude Code plugins (official `claude plugin` CLI) ----------
const PLUGIN_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}(@[A-Za-z0-9][A-Za-z0-9._-]{0,80})?$/;
const REPO_RX = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
async function claudePlugin(args, ctx) {
  const bin = findClaudeBinary();
  if (!bin) throw permanent('O Claude Code não está instalado.', { action: 'Instalar o Claude Code em Ligações' });
  return stream(bin, ['plugin', ...args], ctx, { timeoutMs: 10 * 60e3 });
}
async function pluginList() {
  const bin = findClaudeBinary();
  if (!bin) return [];
  try { const { stdout } = await pexec(bin, ['plugin', 'list', '--json'], { timeout: 60000, env: childEnv() }); return JSON.parse(stdout); } catch { return []; }
}
const findPlugin = (list, name) => list.find(x => x.id === name || String(x.id).split('@')[0] === name.split('@')[0] && (!name.includes('@') || x.id === name));

registerHandler('plugin.install', {
  async plan(db, p) {
    if (!PLUGIN_RX.test(p.plugin || '') || !REPO_RX.test(p.marketplace || '')) throw new Error('Plugin ou marketplace inválido.');
    return { category: 'plugin_trusted', publisher: p.marketplace.split('/')[0], resource: `plugin:${p.plugin}`, lockKey: `plugin:${p.plugin}`, source: `https://github.com/${p.marketplace}` };
  },
  async run(db, p, ctx) {
    ctx.stage('A ler os plugins instalados', 0.05);
    const existing = findPlugin(await pluginList(), p.plugin);
    if (existing && existing.scope !== 'synced') return { verified: true, verification: { already_installed: existing.id, enabled: existing.enabled } };
    if (ctx.cancelled()) return { cancelled: true };
    ctx.stage(`A instalar o plugin ${p.plugin} a partir de ${p.marketplace}`, null);
    // --marketplace adds the marketplace first (user settings) under Claude Code's own checks.
    await claudePlugin(['install', p.plugin, '--marketplace', p.marketplace, '--scope', 'user'], ctx);
    ctx.stage('A verificar', 0.9);
    const after = findPlugin(await pluginList(), p.plugin);
    if (after) db.prepare(`INSERT INTO installed_instances(resource_id,name,kind,scope,path,managed_by_curi,checksum,health,details,observed_at) VALUES (?,?,?,?,?,1,NULL,'verified',?,?)
      ON CONFLICT(kind,scope,name) DO UPDATE SET resource_id=COALESCE(excluded.resource_id, installed_instances.resource_id), managed_by_curi=1, health='verified', details=excluded.details, observed_at=excluded.observed_at`)
      .run(p.resource_id || null, after.id, 'plugin', 'user', after.installPath || null, JSON.stringify({ version: after.version, enabled: after.enabled, marketplace: p.marketplace }), now());
    return { verified: Boolean(after), verification: { plugin: after?.id || null, version: after?.version || null, enabled: after?.enabled ?? null }, recovery: { uninstall: `plugin.uninstall ${after?.id || p.plugin}` } };
  },
});

for (const [kind, verb, category, label] of [['plugin.enable', 'enable', 'maintenance', 'A ativar'], ['plugin.disable', 'disable', 'destructive', 'A desativar'], ['plugin.update', 'update', 'maintenance', 'A atualizar'], ['plugin.uninstall', 'uninstall', 'destructive', 'A desinstalar']]) {
  registerHandler(kind, {
    async plan(db, p) {
      if (!PLUGIN_RX.test(p.plugin || '')) throw new Error('Plugin inválido.');
      return { category, publisher: p.publisher || null, resource: `plugin:${p.plugin}`, lockKey: `plugin:${p.plugin}`, source: 'claude plugin' };
    },
    async run(db, p, ctx) {
      const before = findPlugin(await pluginList(), p.plugin);
      if (!before) { if (verb === 'uninstall') return { verified: true, verification: { already_absent: true } }; throw permanent('O plugin não está instalado.'); }
      if (before.scope === 'synced') throw permanent('Este plugin vem da sua conta claude.ai; gere-o em claude.ai › Definições.', { action: 'Abrir as definições da conta' });
      if ((verb === 'enable' && before.enabled) || (verb === 'disable' && !before.enabled)) return { verified: true, verification: { unchanged: true, enabled: before.enabled } };
      ctx.stage(`${label} ${before.id}`, null);
      await claudePlugin([verb, before.id, ...(['enable', 'disable', 'uninstall'].includes(verb) ? ['--scope', before.scope || 'user'] : [])], ctx);
      const after = findPlugin(await pluginList(), before.id);
      const ok = verb === 'uninstall' ? !after : verb === 'enable' ? Boolean(after?.enabled) : verb === 'disable' ? after && !after.enabled : Boolean(after);
      if (verb === 'uninstall' && ok) db.prepare("DELETE FROM installed_instances WHERE kind='plugin' AND name=?").run(before.id);
      return { verified: Boolean(ok), verification: { before: { version: before.version, enabled: before.enabled }, after: after ? { version: after.version, enabled: after.enabled } : null } };
    },
  });
}

// ---------- MCP from a resource profile (defines it in CURI, then registers via the launcher) ----------
const SERVER_RX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function optionFor(db, p) {
  const prof = profileFor(db, p.resource_id);
  const o = prof?.options.find(x => x.id === p.option_id && x.method === 'mcp');
  if (!o) throw new Error('Opção MCP inexistente para este recurso.');
  return { prof, o };
}
const serverName = (db, p, o) => (o.name || db.prepare('SELECT name FROM resources WHERE id=?').get(p.resource_id).name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

registerHandler('mcp.add', {
  async plan(db, p) {
    const { o } = optionFor(db, p);
    const name = serverName(db, p, o);
    if (!SERVER_RX.test(name)) throw new Error('Nome de servidor inválido.');
    const { credentialFor } = await import('./connections.mjs');
    const missing = [];
    for (const s of o.secrets || []) if (!(await credentialFor(`secret:${s.toLowerCase().replace(/_/g, '-')}`))) missing.push(s);
    return { category: 'mcp_trusted', publisher: ownerOf(db, p.resource_id), resource: `mcp:${name}`, lockKey: `mcp:${name}`, source: o.url || [o.command, ...(o.args || [])].join(' '),
      requiresConnection: missing.length ? `segredo ${missing.join(', ')} (Ligações › Segredos)` : null, connectionOk: !missing.length };
  },
  async run(db, p, ctx) {
    const { o } = optionFor(db, p);
    const name = serverName(db, p, o);
    const cur = readJson(claudeJsonPath())?.mcpServers?.[name];
    const secretEnv = Object.fromEntries((o.secrets || []).map(s => [s, `secret:${s.toLowerCase().replace(/_/g, '-')}`]));
    const existingDef = db.prepare('SELECT * FROM mcp_definitions WHERE name=?').get(name);
    if (cur && !existingDef) {
      // Already registered outside CURI: adopt it as-is instead of overwriting.
      ctx.log(`Já existe uma entrada "${name}" no Claude Code (criada fora do CURI); mantida tal como está.`);
    } else {
      ctx.stage('A guardar a definição no CURI', 0.15);
      db.prepare(`INSERT INTO mcp_definitions(name,transport,command,args,url,env,secret_env,publisher,resource_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
        ON CONFLICT(name) DO UPDATE SET transport=excluded.transport, command=excluded.command, args=excluded.args, url=excluded.url, secret_env=excluded.secret_env, resource_id=excluded.resource_id, updated_at=excluded.updated_at`)
        .run(name, o.transport || 'stdio', o.command || null, JSON.stringify(o.args || []), o.url || null, '{}', JSON.stringify(secretEnv), ownerOf(db, p.resource_id), p.resource_id, now(), now());
      if (!cur) {
        ctx.stage('A registar no Claude Code', 0.35);
        const before = otherEntries(name);
        if ((o.transport || 'stdio') === 'stdio') { const l = mcpLauncherSpec(name); await claudeMcp(['add', '--scope', 'user', name, '--', l.command, ...l.args]); }
        else await claudeMcp(['add', '--scope', 'user', '--transport', o.transport, name, o.url]);
        if (otherEntries(name) !== before) throw permanent('Outras entradas MCP mudaram durante o registo — abortado.');
      }
      db.prepare('UPDATE mcp_definitions SET enabled=1, updated_at=? WHERE name=?').run(now(), name);
    }
    ctx.stage('A testar a ligação (claude mcp list)', 0.7);
    const h = await mcpHealth(findClaudeBinary());
    const s = h.servers.find(x => x.name === name);
    const needsAuth = Boolean(s && /auth|401/i.test(s.status));
    if (needsAuth || o.auth === 'oauth') ctx.log('Este servidor usa autenticação OAuth: no Claude Code, escreva /mcp e escolha Autenticar para concluir.');
    for (const step of o.setup || []) ctx.log(`Passo manual: ${step}`);
    return { verified: Boolean(s?.healthy), verification: { listed: Boolean(s), healthy: Boolean(s?.healthy), status: s?.status || 'não listado', needs_auth: needsAuth || o.auth === 'oauth', manual_steps: o.setup || [] }, recovery: { disable: `mcp.disable ${name}` } };
  },
});

// Removes an MCP entry that CURI did not create, through the official CLI (one scope, one name).
registerHandler('mcp.remove', {
  async plan(db, p) {
    if (!SERVER_RX.test(p.name || '') && !/^[A-Za-z0-9_.-]{1,64}$/.test(p.name || '')) throw new Error('Nome inválido.');
    if (p.name === 'curi') throw new Error('O MCP do CURI é gerido no Claude Bridge.');
    if (!['user', 'local', 'project'].includes(p.scope || 'user')) throw new Error('Âmbito inválido.');
    return { category: 'destructive', resource: `mcp:${p.name}`, lockKey: `mcp:${p.name}`, source: 'claude mcp remove' };
  },
  async run(db, p, ctx) {
    ctx.stage(`A remover ${p.name} do Claude Code`, null);
    const before = otherEntries(p.name);
    await claudeMcp(['remove', '--scope', p.scope || 'user', p.name]).catch(e => { throw permanent(`O Claude Code recusou: ${String(e.stderr || e.message).slice(0, 200)}`); });
    if (otherEntries(p.name) !== before) throw permanent('Outras entradas MCP mudaram — verifique o Claude Code.');
    db.prepare('UPDATE mcp_definitions SET enabled=0, updated_at=? WHERE name=?').run(now(), p.name);
    return { verified: !readJson(claudeJsonPath())?.mcpServers?.[p.name], verification: { removed: p.name } };
  },
});

registerHandler('mcp.check', {
  async plan() { return { category: 'observe', resource: 'servidores MCP', lockKey: 'mcp.check', source: 'claude mcp list', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    ctx.stage('A testar todos os servidores MCP (claude mcp list)', null);
    const h = await mcpHealth(findClaudeBinary());
    for (const s of h.servers) ctx.log(`${s.healthy ? '✓' : '✗'} ${s.name}: ${s.status}`);
    return { verified: h.servers.every(s => s.healthy), verification: { servers: h.servers } };
  },
});

registerHandler('resource.inspect', {
  async plan(db, p) {
    if (!db.prepare('SELECT 1 FROM resources WHERE id=?').get(p.id || '')) throw new Error('Recurso inexistente.');
    return { category: 'observe', resource: p.id, lockKey: `inspect:${p.id}`, source: 'GitHub e registos de pacotes', maxAttempts: 2 };
  },
  async run(db, p, ctx) {
    ctx.stage('A ler o repositório, os manifestos e o README', 0.2);
    const f = await inspectResource(db, p.id);
    ctx.stage('A confirmar pacotes nos registos', 0.9);
    const pk = Object.entries(f.packages || {}).map(([k, v]) => `${k}: ${v.map(x => `${x.name} ${x.version || ''}`).join(', ')}`);
    ctx.log(f.reachable === false ? 'Fonte inacessível.' : `${f.files_total ?? '—'} ficheiros · ${f.skills?.length || 0} skills · ${pk.join(' · ') || 'sem pacotes publicados'}`);
    return { verified: f.reachable !== false, verification: { reachable: f.reachable, packages: Object.keys(f.packages || {}), skills: f.skills?.length || 0 } };
  },
});

export { packageManagers };

// ---------- Add a library to one of the user's projects ----------
registerHandler('project.add', {
  async plan(db, p) {
    const { describeProject, planProjectCommand } = await import('./projects.mjs');
    const proj = describeProject(String(p.path || ''));
    if (!proj.exists) throw new Error('Projeto inexistente.');
    const steps = String(p.command || '').split('&&').map(c => planProjectCommand(c, proj, { component: p.component }));
    const bad = steps.find(s => s.error || s.needs);
    if (bad?.error) throw new Error(bad.error);
    if (bad?.needs) throw new Error('Indique o nome do componente.');
    if (p.component && !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(p.component)) throw new Error('Nome de componente inválido.');
    return { category: 'project_change', resource: `${proj.name}: ${p.command}`, lockKey: `project:${proj.path}`, source: proj.path };
  },
  async run(db, p, ctx) {
    const { describeProject, planProjectCommand, verifyInProject } = await import('./projects.mjs');
    const proj = describeProject(p.path);
    const steps = String(p.command).split('&&').map(c => planProjectCommand(c, proj, { component: p.component }));
    const results = [];
    for (const [i, s] of steps.entries()) {
      if (ctx.cancelled()) return { cancelled: true };
      ctx.stage(`A executar em ${proj.name}: ${s.cmd} ${s.args.join(' ')}`, steps.length > 1 ? i / steps.length : null);
      await new Promise((resolve, reject) => {
        const child = spawn(s.cmd, s.args, { cwd: proj.path, env: { ...childEnv(), CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let tail = '';
        const on = d => { tail = (tail + d).slice(-6000); const l = String(d).split(/\r?\n/).filter(Boolean).pop(); if (l) ctx.log(l.slice(0, 200)); };
        child.stdout.on('data', on); child.stderr.on('data', on);
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${s.cmd} terminou com código ${code}: ${tail.split('\n').filter(Boolean).slice(-2).join(' · ').slice(0, 300)}`))));
      });
      results.push(verifyInProject(proj, s.verify));
    }
    const ok = results.every(r => r !== false);
    return { verified: results.every(r => r === true), verification: { project: proj.path, in_manifest: results, ok } };
  },
});
