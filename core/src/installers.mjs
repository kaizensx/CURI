// Operation handlers. Every run() is idempotent, verifies the observed result, and records recovery info.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { registerHandler, permanent } from './operations.mjs';
import { paths, claudeHome, claudeJsonPath, dataDir, ensureDir } from './paths.mjs';
import { now } from './db.mjs';
import { scanText } from './security.mjs';
import { lsRemote, verifyResource } from './github.mjs';
import { planBridgeInstall, applyBridgeInstall, nodeBin } from './bridge.mjs';
import { findClaudeBinary, mcpHealth, sha256File } from './env.mjs';
import { credentialFor } from './connections.mjs';

const pexec = promisify(execFile);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const SKILL_NAME_RX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_RX = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SUBPATH_RX = /^[A-Za-z0-9._/-]{1,200}$/;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function frontmatterName(text) { return text.match(/^---\n[\s\S]*?\nname:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim(); }
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isSymbolicLink()) throw permanent(`O pacote contém uma ligação simbólica (${e.name}); recusado.`); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
function hashTree(dir) { return Object.fromEntries(walk(dir).map(f => [path.relative(dir, f), sha(fs.readFileSync(f))])); }

// ---------- CURI's own integration ----------
registerHandler('curi.integration', {
  async plan() { return { category: 'curi_integration', resource: 'curi-resource-router + mcp:curi', lockKey: 'curi.integration', source: 'local' }; },
  async run(db, params, ctx) {
    ctx.stage('A planear', 0.1);
    const plan = planBridgeInstall();
    if (plan.conflicts.length) throw permanent(`Conflito: ${plan.conflicts.map(c => c.reason).join(' ')}`, { action: 'Resolver o conflito no Claude Bridge' });
    const todo = plan.actions.filter(a => a.state !== 'already-applied').map(a => a.id);
    if (!todo.length) { ctx.log('Já aplicada; nada a fazer.'); return { verified: true, verification: { already_applied: true } }; }
    if (ctx.cancelled()) return { cancelled: true };
    ctx.stage(`A aplicar ${todo.join(', ')}`, 0.5);
    const r = await applyBridgeInstall(db, { approve: todo, actor: 'operations' });
    if (!r.applied) throw permanent(`Não aplicado: ${r.reason}${r.error ? ` — ${r.error}` : ''}`, { tx: r.tx });
    ctx.stage('A verificar', 0.9);
    const after = planBridgeInstall();
    const ok = after.actions.every(a => a.state === 'already-applied');
    return { verified: ok, verification: { tx: r.tx, idempotent_plan: ok }, recovery: { rollback_tx: r.tx } };
  },
});

// ---------- Skills from a GitHub repository, pinned to a commit ----------
export function skillTarget(name) { return path.join(claudeHome(), 'skills', name); }

registerHandler('skill.install', {
  async plan(db, p) {
    if (!REPO_RX.test(p.repo || '') || !SUBPATH_RX.test(p.path || '') || p.path.includes('..')) throw new Error('Repositório ou caminho inválido.');
    const name = p.name || path.basename(p.path);
    if (!SKILL_NAME_RX.test(name)) throw new Error('Nome de skill inválido.');
    // Updating a skill CURI already manages is maintenance; new code still faces the script gate in run().
    const managed = p.update && db.prepare("SELECT 1 FROM installed_instances WHERE kind='skill' AND name=? AND managed_by_curi=1").get(name);
    return { category: managed ? 'maintenance' : 'skill_trusted', publisher: p.repo.split('/')[0], resource: `skill:${name}`, source: `https://github.com/${p.repo}/tree/${p.ref || 'HEAD'}/${p.path}`, lockKey: `skill:${name}` };
  },
  async run(db, p, ctx) {
    const name = p.name || path.basename(p.path);
    const dest = skillTarget(name);
    ctx.stage('A resolver o commit', 0.05);
    const ls = await lsRemote(`https://github.com/${p.repo}.git`);
    if (!ls.exists) throw new Error(`Repositório inacessível: ${ls.error}`);
    const commit = p.commit && /^[0-9a-f]{40}$/.test(p.commit) ? p.commit : ls.head;
    const marker = readJson(path.join(dest, '.curi-managed.json'));
    if (fs.existsSync(dest) && !marker) throw permanent(`Já existe uma skill "${name}" que não é gerida pelo CURI; não será sobrescrita.`, { action: 'Renomeie ou remova a skill existente' });
    if (marker?.commit === commit && marker.files && Object.entries(marker.files).every(([f, h]) => sha256File(path.join(dest, f)) === h)) {
      ctx.log('A mesma versão já está instalada e íntegra.');
      return { verified: true, verification: { commit, idempotent: true } };
    }
    if (ctx.cancelled()) return { cancelled: true };
    ctx.stage('A transferir o pacote fixo', 0.2);
    const work = fs.mkdtempSync(path.join(ensureDir(path.join(dataDir(), 'tmp')), 'skill-'));
    try {
      const res = await fetch(`https://codeload.github.com/${p.repo}/tar.gz/${commit}`, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`Transferência falhou: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 50e6) throw permanent('Pacote demasiado grande (>50 MB).');
      fs.writeFileSync(path.join(work, 'pkg.tgz'), buf);
      const top = `${p.repo.split('/')[1]}-${commit}`;
      fs.mkdirSync(path.join(work, 'x'));
      await pexec('/usr/bin/tar', ['-xzf', path.join(work, 'pkg.tgz'), '-C', path.join(work, 'x'), `${top}/${p.path}`], { timeout: 120000 });
      const src = path.join(work, 'x', top, p.path);
      if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw permanent(`Não existe SKILL.md em ${p.path} neste commit.`);
      ctx.checkpoint({ commit, tarball_sha256: sha(buf) });
      if (ctx.cancelled()) return { cancelled: true };
      ctx.stage('Análise estática', 0.5);
      const files = walk(src);
      const findings = [];
      let executables = 0;
      for (const f of files) {
        const rel = path.relative(src, f);
        const st = fs.statSync(f);
        if (st.mode & 0o111) executables++;
        if (st.size < 2e6 && !/\.(png|jpe?g|gif|webp|ico|pdf|zip|ttf|woff2?)$/i.test(f)) {
          const r = scanText(fs.readFileSync(f, 'utf8'), { source: rel });
          for (const x of r.findings) findings.push({ file: rel, ...x });
        }
      }
      const high = findings.filter(f => f.severity === 'high');
      if (high.length) throw permanent(`Bloqueado pela análise de segurança: ${high.slice(0, 3).map(f => `${f.file}:${f.line} ${f.rule}`).join('; ')}`, { findings: high.slice(0, 20) });
      const scripts = files.filter(f => /\.(sh|py|js|mjs|ts|rb|pl)$/i.test(f)).length;
      // Executable content: Maximum Autonomy covers trusted publishers with a clean scan; anything with
      // review findings, and every other mode, needs a person to approve this specific installation.
      const review = findings.some(f => f.severity === 'medium');
      const codeCovered = ctx.mode === 'maximum' && !review;
      if ((scripts || executables || review) && !ctx.approvedByUser && !codeCovered) {
        return { needsApproval: [`A skill inclui ${scripts} script(s) e ${executables} ficheiro(s) executável(eis)${findings.length ? ` e ${findings.length} achado(s) de revisão` : ''}. Revisão humana necessária antes de instalar.`] };
      }
      if (ctx.cancelled()) return { cancelled: true };
      ctx.stage('A instalar', 0.75);
      const nameInFile = frontmatterName(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'));
      const staged = path.join(path.dirname(dest), `.${name}.curi-staging-${process.pid}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(staged, { recursive: true, force: true });
      fs.cpSync(src, staged, { recursive: true });
      const fileHashes = hashTree(staged);
      fs.writeFileSync(path.join(staged, '.curi-managed.json'), JSON.stringify({ managed_by: 'curi', repo: p.repo, path: p.path, commit, files: fileHashes, installed_at: now() }, null, 2));
      let backup = null;
      if (fs.existsSync(dest)) { backup = path.join(paths.backups, `skill-${name}-${Date.now()}`); fs.renameSync(dest, backup); }
      fs.renameSync(staged, dest);
      ctx.stage('A verificar', 0.9);
      const ok = Object.entries(fileHashes).every(([f, hsh]) => sha256File(path.join(dest, f)) === hsh);
      db.prepare(`INSERT INTO installed_instances(resource_id,name,kind,scope,path,managed_by_curi,checksum,health,details,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(kind,scope,name) DO UPDATE SET resource_id=COALESCE(excluded.resource_id, installed_instances.resource_id), path=excluded.path, managed_by_curi=1, checksum=excluded.checksum, health=excluded.health, details=excluded.details, observed_at=excluded.observed_at`)
        .run(p.resource_id || db.prepare('SELECT id FROM resources WHERE lower(gh_full_name)=lower(?)').get(p.repo)?.id || null, name, 'skill', 'user', dest, 1, commit, ok ? 'files-ok' : 'drift', JSON.stringify({ repo: p.repo, path: p.path, frontmatter_name: nameInFile }), now());
      return { verified: ok, verification: { commit, files: Object.keys(fileHashes).length, frontmatter_name: nameInFile, scan_findings: findings.length }, recovery: { previous_version_backup: backup, remove: `skill.remove ${name}` } };
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  },
});

registerHandler('skill.remove', {
  async plan(db, p) {
    if (!SKILL_NAME_RX.test(p.name || '')) throw new Error('Nome de skill inválido.');
    if (p.name === 'curi-resource-router') throw new Error('A skill do CURI é removida pelo Claude Bridge (reversão da transação).');
    return { category: 'destructive', resource: `skill:${p.name}`, lockKey: `skill:${p.name}`, source: 'local' };
  },
  async run(db, p, ctx) {
    const dest = skillTarget(p.name);
    const marker = readJson(path.join(dest, '.curi-managed.json'));
    if (!fs.existsSync(dest)) return { verified: true, verification: { already_absent: true } };
    if (!marker) throw permanent('Esta skill não foi instalada pelo CURI; não será removida.');
    const drift = Object.entries(marker.files || {}).filter(([f, h]) => sha256File(path.join(dest, f)) !== h).map(([f]) => f);
    if (drift.length && !ctx.approvedByUser) return { needsApproval: [`Ficheiros alterados fora do CURI: ${drift.join(', ')}. Confirme para mover mesmo assim (fica uma cópia em backups).`] };
    const backup = path.join(paths.backups, `skill-${p.name}-removed-${Date.now()}`);
    fs.renameSync(dest, backup);
    db.prepare("DELETE FROM installed_instances WHERE kind='skill' AND scope='user' AND name=?").run(p.name);
    return { verified: !fs.existsSync(dest), verification: { moved_to: backup }, recovery: { restore_from: backup } };
  },
});

// ---------- MCP servers via the CURI launcher (secrets injected from the Keychain at spawn time) ----------
export function mcpLauncherSpec(name) { return { command: nodeBin(), args: [paths.cliEntry, 'mcp-exec', name] }; }

export async function claudeMcp(args) {
  const bin = findClaudeBinary();
  if (!bin) throw permanent('O Claude Code não está instalado.', { action: 'Instalar o Claude Code em Ligações' });
  return pexec(bin, ['mcp', ...args], { timeout: 60000 });
}
export const otherEntries = name => JSON.stringify(Object.entries(readJson(claudeJsonPath())?.mcpServers || {}).filter(([k]) => k !== name).sort());

registerHandler('mcp.enable', {
  async plan(db, p) {
    const d = db.prepare('SELECT * FROM mcp_definitions WHERE name=?').get(p.name);
    if (!d) throw new Error('Definição MCP inexistente.');
    const secrets = JSON.parse(d.secret_env);
    const missing = [];
    for (const ref of Object.values(secrets)) if (!(await credentialFor(ref))) missing.push(ref);
    return { category: p.repair && d.enabled ? 'maintenance' : 'mcp_trusted', publisher: d.publisher, resource: `mcp:${d.name}`, lockKey: `mcp:${d.name}`, source: d.url || [d.command, ...JSON.parse(d.args)].join(' '),
      requiresConnection: missing.length ? missing.join(', ') : null, connectionOk: !missing.length };
  },
  async run(db, p, ctx) {
    const d = db.prepare('SELECT * FROM mcp_definitions WHERE name=?').get(p.name);
    const cur = readJson(claudeJsonPath())?.mcpServers?.[d.name];
    const want = d.transport === 'stdio' ? mcpLauncherSpec(d.name) : null;
    const before = otherEntries(d.name);
    if (cur && want && (cur.command !== want.command || JSON.stringify(cur.args) !== JSON.stringify(want.args))) throw permanent(`Já existe uma entrada MCP "${d.name}" diferente no Claude Code; não será sobrescrita.`);
    if (!cur) {
      ctx.stage('A registar no Claude Code', 0.3);
      if (d.transport === 'stdio') await claudeMcp(['add', '--scope', 'user', d.name, '--', want.command, ...want.args]);
      else await claudeMcp(['add', '--scope', 'user', '--transport', d.transport, d.name, d.url]);
      if (otherEntries(d.name) !== before) throw permanent('Outras entradas MCP mudaram durante o registo — abortado.');
    }
    db.prepare('UPDATE mcp_definitions SET enabled=1, updated_at=? WHERE name=?').run(now(), d.name);
    ctx.stage('A testar a ligação', 0.7);
    const h = await mcpHealth(findClaudeBinary());
    const s = h.servers.find(x => x.name === d.name);
    const needsAuth = s && /auth/i.test(s.status);
    return { verified: Boolean(s?.healthy), verification: { listed: Boolean(s), healthy: Boolean(s?.healthy), status: s?.status || 'não listado', needs_auth: needsAuth }, recovery: { disable: `mcp.disable ${d.name}` } };
  },
});

registerHandler('mcp.disable', {
  async plan(db, p) { return { category: 'destructive', resource: `mcp:${p.name}`, lockKey: `mcp:${p.name}`, source: 'local' }; },
  async run(db, p, ctx) {
    const d = db.prepare('SELECT * FROM mcp_definitions WHERE name=?').get(p.name);
    if (!d) throw permanent('Só servidores definidos no CURI podem ser desativados aqui.');
    const cur = readJson(claudeJsonPath())?.mcpServers?.[p.name];
    if (cur) { const before = otherEntries(p.name); await claudeMcp(['remove', '--scope', 'user', p.name]); if (otherEntries(p.name) !== before) throw permanent('Outras entradas MCP mudaram — verifique o Claude Code.'); }
    db.prepare('UPDATE mcp_definitions SET enabled=0, updated_at=? WHERE name=?').run(now(), p.name);
    return { verified: !readJson(claudeJsonPath())?.mcpServers?.[p.name], verification: { unregistered: true }, recovery: { enable: `mcp.enable ${p.name}` } };
  },
});

// ---------- Observation work (allowed in every mode) ----------
registerHandler('sources.verify', {
  async plan(db, p) { return { category: 'observe', resource: p.ids?.length === 1 ? p.ids[0] : `${p.ids?.length || p.limit || 40} fontes`, lockKey: p.ids?.length === 1 ? `verify:${p.ids[0]}` : 'sources.verify', source: 'github/http', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const useApi = Boolean(await credentialFor('github')) || p.useApi === true;
    const ids = Array.isArray(p.ids) && p.ids.length ? p.ids.slice(0, 400).map(String) : db.prepare(`SELECT id FROM resources ORDER BY last_verified IS NOT NULL, last_verified LIMIT ?`).all(Math.min(p.limit || 40, 400)).map(r => r.id);
    let ok = 0, fail = 0;
    for (const [i, id] of ids.entries()) {
      if (ctx.cancelled()) return { cancelled: true, recovery: { verified_so_far: ok } };
      ctx.stage(`A verificar ${i + 1}/${ids.length}`, i / ids.length);
      try { const r = await verifyResource(db, id, { useApi }); r.checks.some(c => c.exists === true || c.ok) ? ok++ : fail++; } catch (e) { fail++; if (e.code === 'RATE_LIMIT') { ctx.log(e.message, 'warn'); break; } }
    }
    return { verified: true, verification: { attempted: ids.length, ok, fail, github_api: useApi } };
  },
});

registerHandler('cleanup.temp', {
  async plan() { return { category: 'cleanup', resource: 'ficheiros temporários do CURI', lockKey: 'cleanup', source: 'local' }; },
  async run() {
    const tmp = path.join(dataDir(), 'tmp');
    let removed = 0;
    if (fs.existsSync(tmp)) for (const e of fs.readdirSync(tmp)) { fs.rmSync(path.join(tmp, e), { recursive: true, force: true }); removed++; }
    return { verified: true, verification: { removed } };
  },
});

// ---------- Background agent (user LaunchAgent; no privileges) ----------
export const AGENT_LABEL = process.env.CURI_AGENT_LABEL || 'app.curi.agent';
const agentsDir = () => process.env.CURI_LAUNCHAGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
export const agentPlistPath = () => path.join(agentsDir(), `${AGENT_LABEL}.plist`);
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function agentStatus() {
  const plist = agentPlistPath();
  let loaded = false;
  try { await pexec('/bin/launchctl', ['print', `gui/${process.getuid()}/${AGENT_LABEL}`], { timeout: 10000 }); loaded = true; } catch {}
  return { label: AGENT_LABEL, plist, installed: fs.existsSync(plist), loaded, interval_s: Number(readPlistInterval(plist)) || null };
}
function readPlistInterval(p) { try { return fs.readFileSync(p, 'utf8').match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]; } catch { return null; } }

registerHandler('agent.install', {
  async plan(db, p) { return { category: 'background', resource: `launchagent:${AGENT_LABEL}`, lockKey: 'agent', source: 'local' }; },
  async run(db, p, ctx) {
    const interval = Math.max(300, Math.min(Number(p.interval_s) || 1800, 86400));
    const logs = paths.logs;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(AGENT_LABEL)}</string>
  <key>ProgramArguments</key><array><string>${xml(nodeBin())}</string><string>${xml(paths.cliEntry)}</string><string>daemon</string><string>--once</string></array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict><key>CURI_HOME</key><string>${xml(dataDir())}</string><key>PATH</key><string>${xml(process.env.PATH || '/usr/bin:/bin')}</string></dict>
  <key>StandardOutPath</key><string>${xml(path.join(logs, 'agent.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, 'agent.log'))}</string>
</dict></plist>
`;
    ctx.stage('A escrever o LaunchAgent', 0.3);
    fs.mkdirSync(agentsDir(), { recursive: true });
    const target = agentPlistPath();
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, plist, { mode: 0o644 });
    await pexec('/usr/bin/plutil', ['-lint', tmp]);
    fs.renameSync(tmp, target);
    const domain = `gui/${process.getuid()}`;
    try { await pexec('/bin/launchctl', ['bootout', `${domain}/${AGENT_LABEL}`]); } catch {}
    ctx.stage('A carregar no launchd', 0.6);
    await pexec('/bin/launchctl', ['bootstrap', domain, target]);
    const st = await agentStatus();
    return { verified: st.loaded, verification: st, recovery: { remove: 'agent.remove' } };
  },
});

registerHandler('agent.remove', {
  async plan() { return { category: 'destructive', resource: `launchagent:${AGENT_LABEL}`, lockKey: 'agent', source: 'local' }; },
  async run() {
    try { await pexec('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${AGENT_LABEL}`]); } catch {}
    fs.rmSync(agentPlistPath(), { force: true });
    const st = await agentStatus();
    return { verified: !st.installed && !st.loaded, verification: st };
  },
});

// ---------- Privileged (allowlisted single action, native administrator dialog) ----------
export const CLI_LINK = '/usr/local/bin/curi';
registerHandler('cli.link', {
  async plan() { return { category: 'privileged', resource: CLI_LINK, lockKey: 'cli.link', source: 'local', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const wrapper = path.join(ensureDir(path.join(dataDir(), 'bin')), 'curi');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${nodeBin()}" "${paths.cliEntry}" "$@"\n`, { mode: 0o755 });
    if (fs.existsSync(CLI_LINK) && fs.realpathSync(CLI_LINK) === fs.realpathSync(wrapper)) return { verified: true, verification: { already_linked: true } };
    if (/["'\\$`]/.test(wrapper)) throw permanent('Caminho com caracteres não suportados para a ação de administrador.');
    ctx.stage('A pedir autorização de administrador ao macOS', 0.4);
    const script = `do shell script "/bin/mkdir -p /usr/local/bin && /bin/ln -sfn '${wrapper}' '${CLI_LINK}'" with prompt "O CURI quer instalar o comando 'curi' em /usr/local/bin." with administrator privileges`;
    try { await pexec('/usr/bin/osascript', ['-e', script], { timeout: 300000 }); }
    catch (e) { if (/-128|cancel/i.test(String(e.stderr || e.message))) throw permanent('Autorização de administrador cancelada.'); throw e; }
    const ok = fs.existsSync(CLI_LINK) && fs.realpathSync(CLI_LINK) === fs.realpathSync(wrapper);
    return { verified: ok, verification: { link: CLI_LINK, target: wrapper } };
  },
});

// mcp-exec: resolve Keychain references to env vars and exec the real server (stdio inherited).
export async function execMcp(db, name) {
  const d = db.prepare('SELECT * FROM mcp_definitions WHERE name=?').get(name);
  if (!d || d.transport !== 'stdio') { process.stderr.write(`CURI: servidor MCP desconhecido: ${name}\n`); process.exit(2); }
  const env = { ...process.env, ...JSON.parse(d.env) };
  for (const [k, ref] of Object.entries(JSON.parse(d.secret_env))) {
    const v = await credentialFor(ref);
    if (!v) { process.stderr.write(`CURI: falta a credencial ${ref} para ${name}. Ligue-a em CURI → Ligações.\n`); process.exit(3); }
    env[k] = v;
  }
  db.close();
  const child = spawn(d.command, JSON.parse(d.args), { stdio: 'inherit', env });
  child.on('exit', code => process.exit(code ?? 1));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
}

// ---------- System detection, discovery, verification, rollback ----------
registerHandler('system.scan', {
  async plan() { return { category: 'observe', resource: 'este dispositivo', lockKey: 'system.scan', source: 'local', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const { scanSystem } = await import('./detect.mjs');
    const r = await scanSystem(db, { onStage: (s, pr) => ctx.stage(s, pr), cancelled: ctx.cancelled });
    if (r.cancelled) return { cancelled: true };
    ctx.log(`${r.matched.length} recursos do catálogo encontrados; ${r.changes.installed.length} novos instalados, ${r.changes.configured.length} configurados, ${r.changes.removed.length} já não encontrados.`);
    return { verified: true, verification: { matched: r.matched.length, changes: r.changes, sources: r.sources } };
  },
});

registerHandler('discover', {
  async plan(db, p) { return { category: 'observe', resource: p.mode === 'frontier' ? 'reconhecimento de fronteira' : `descoberta: ${String(p.intent || '').slice(0, 60)}`, lockKey: 'discover', source: 'api.github.com', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const { discover } = await import('./discover.mjs');
    let total = 1, done = 0;
    const r = await discover(db, { mode: p.mode === 'frontier' ? 'frontier' : 'task', intent: String(p.intent || ''), windows: p.windows, maxQueries: p.maxQueries || 6, actor: 'operations',
      onPlan: qs => { total = qs.length; ctx.stage(`${total} consulta(s) planeada(s)`, 0.02); },
      onEvent: e => { done++; ctx.stage(`Consulta ${done}/${total}: ${e.q.q}${e.error ? ` — ${e.error}` : ` (${e.n} resultados)`}`, done / total); } });
    ctx.log(`Execução #${r.scanId}: ${r.status}, ${r.total} resultados.`);
    if (r.status === 'failed') throw permanent(`A descoberta falhou: ${r.errors} consulta(s) com erro (rede ou limite do GitHub).`);
    return { verified: true, verification: { scan_id: r.scanId, status: r.status, results: r.total, independent_share: r.independentShare } };
  },
});

registerHandler('github.stars', {
  async plan() { return { category: 'observe', resource: 'estrelas do GitHub', lockKey: 'github.stars', source: 'api.github.com/user/starred', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const { importStars } = await import('./discover.mjs');
    const r = await importStars(db, { onStage: (s, pr) => ctx.stage(s, pr) });
    ctx.log(`${r.total} repositórios com estrela; ${r.known} já no catálogo; ${r.relevant} novos relevantes para agentes.`);
    return { verified: true, verification: r };
  },
});

registerHandler('verify.run', {
  async plan(db, p) { return { category: p.cleanSession ? 'costly' : 'observe', resource: 'integração CURI', lockKey: 'verify.run', source: 'local', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const { runVerification } = await import('./verify.mjs');
    const v = await runVerification(db, { requireBridge: p.requireBridge !== false, cleanSession: Boolean(p.cleanSession), actor: 'operations', onProgress: (id, pr) => ctx.stage(`A verificar: ${id}`, pr) });
    if (p.cleanSession) { const { recordVerification } = await import('./claude-auth.mjs'); const c = v.checks.find(x => x.id === 'claude.clean_session'); if (c) recordVerification(c.status === 'pass' ? { status: 'COMPLETED', ok: true } : { status: c.status === 'blocked' ? 'BLOCKED' : 'FAILED', reason: JSON.stringify(c.evidence).slice(0, 300) }); }
    return { verified: v.verdict !== 'FAILED', verification: { verdict: v.verdict, passed: v.passed, total: v.total, checks: v.checks.map(c => ({ id: c.id, status: c.status, mandatory: c.mandatory, ms: c.ms, evidence: c.evidence })), receipt_file: v.receipt_file } };
  },
});

registerHandler('curi.rollback', {
  async plan(db, p) { if (!/^tx-[\w-]{1,60}$/.test(p.tx || '')) throw new Error('Transação inválida.'); return { category: 'destructive', resource: p.tx, lockKey: 'curi.integration', source: 'local', maxAttempts: 1 }; },
  async run(db, p, ctx) {
    const { rollback } = await import('./bridge.mjs');
    ctx.stage('A reverter a transação', 0.4);
    const r = await rollback(db, p.tx, { actor: 'operations' });
    if (r.status === 'rollback_partial') throw permanent(`Reversão parcial: ${r.results.filter(x => !x.ok).map(x => x.reason).join(' ')}`, { results: r.results });
    return { verified: true, verification: r };
  },
});

import './handlers.mjs';
