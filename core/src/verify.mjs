// Independent verification engine: every check inspects real state (DB, files, processes) and never
// trusts an agent's natural-language claim.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths, claudeJsonPath } from './paths.mjs';
import { currentVersion, SCHEMA_VERSION, now } from './db.mjs';
import { SEED_FILES, parseSeedFile } from './registry.mjs';
import { search } from './search.mjs';
import { verifyChain, audit } from './audit-log.mjs';
import { planBridgeInstall, refreshInstalledInstances, SKILL_NAME, MCP_NAME } from './bridge.mjs';
import { findClaudeBinary, mcpHealth } from './env.mjs';
import { runClaudeJob } from './claude-runner.mjs';
import { TOOLS } from './mcp.mjs';

const pexec = promisify(execFile);

export function mcpRoundTrip(calls, { timeoutMs = 15000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [paths.cliEntry, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const responses = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP timeout')); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        responses.set(msg.id, msg);
        if (responses.size === calls.length) { clearTimeout(timer); child.stdin.end(); resolve(calls.map(c => responses.get(c.id))); }
      }
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    for (const c of calls) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...c }) + '\n');
  });
}

const checkOne = async (id, mandatory, fn) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { id, mandatory, status: r.status || (r.ok ? 'pass' : 'fail'), evidence: r.evidence ?? r, ms: Date.now() - t0 };
  } catch (e) {
    return { id, mandatory, status: 'fail', evidence: { error: e.message }, ms: Date.now() - t0 };
  }
};

export async function runVerification(db, { requireBridge = true, cleanSession = true, actor = 'system', onProgress = () => {} } = {}) {
  const checks = [];
  const total = cleanSession ? 13 : 12;
  let n = 0;
  const check = async (id, mandatory, fn) => { onProgress(id, n++ / total); return checkOne(id, mandatory, fn); };
  checks.push(await check('db.integrity', true, () => {
    const ic = db.prepare('PRAGMA integrity_check').get();
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    return { ok: Object.values(ic)[0] === 'ok' && fk.length === 0 && currentVersion(db) === SCHEMA_VERSION, evidence: { integrity: Object.values(ic)[0], fk_violations: fk.length, schema: currentVersion(db) } };
  }));
  checks.push(await check('registry.seed_preservation', true, () => {
    const files = SEED_FILES;
    const urls = new Set(files.flatMap(f => parseSeedFile(f).entries.map(e => e.url)));
    const have = new Set(db.prepare('SELECT DISTINCT url_original FROM resource_urls').all().map(r => r.url_original));
    const missing = [...urls].filter(u => !have.has(u));
    const rea = db.prepare("SELECT id FROM resources WHERE gh_full_name='morluto/rea'").get();
    return { ok: missing.length === 0 && Boolean(rea), evidence: { seed_urls: urls.size, missing: missing.slice(0, 20), rea_present: Boolean(rea) } };
  }));
  checks.push(await check('index.fts_consistency', true, () => {
    const a = db.prepare('SELECT COUNT(*) n FROM resources').get().n, b = db.prepare('SELECT COUNT(*) n FROM resources_fts').get().n;
    return { ok: a === b && a > 0, evidence: { resources: a, fts_rows: b } };
  }));
  checks.push(await check('search.smoke', true, () => {
    const cases = [['agent-native reverse engineering', 'gh:morluto/rea'], ['animated react components text effects', 'web:reactbits.dev'], ['controlar o Blender a partir do agente', 'gh:ahujasid/mcp-for-blender']];
    const res = cases.map(([qq, want]) => { const ids = search(db, qq, { limit: 5 }).results.map(r => r.id); return { query: qq, want, top5: ids, ok: ids.includes(want) }; });
    return { ok: res.every(r => r.ok), evidence: res };
  }));
  checks.push(await check('cli.smoke', true, async () => {
    const { stdout } = await pexec(process.execPath, [paths.cliEntry, 'search', 'React Bits', '--json', '--limit', '3'], { timeout: 20000 });
    const j = JSON.parse(stdout);
    return { ok: j.results?.some(r => r.id === 'web:reactbits.dev'), evidence: { top: j.results?.map(r => r.id) } };
  }));
  checks.push(await check('mcp.live_stdio', true, async () => {
    const [init, list, call] = await mcpRoundTrip([
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curi-verifier', version: '1' } } },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'search_resources', arguments: { query: 'reverse engineering MCP for agents', limit: 3 } } },
    ]);
    const found = JSON.parse(call.result.content[0].text).results.map(r => r.id);
    return { ok: init.result?.serverInfo?.name === 'curi' && list.result.tools.length === TOOLS.length && found.includes('gh:morluto/rea'), evidence: { protocol: init.result?.protocolVersion, tools: list.result.tools.map(t => t.name), search_top: found } };
  }));
  checks.push(await check('mcp.access_control', true, async () => {
    const [bad1, bad2, bad3] = await mcpRoundTrip([
      { id: 1, method: 'tools/call', params: { name: 'run_shell', arguments: { cmd: 'id' } } },
      { id: 2, method: 'tools/call', params: { name: 'search_resources', arguments: { query: 'x', path: '/etc/passwd' } } },
      { id: 3, method: 'tools/call', params: { name: 'record_discovery', arguments: { url: 'file:///etc/passwd' } } },
    ]);
    const noExecTool = !TOOLS.some(t => /shell|exec|command|file/i.test(t.name));
    return { ok: Boolean(bad1.error && bad2.error && bad3.error) && noExecTool, evidence: { unknown_tool: bad1.error?.message, extra_arg: bad2.error?.message, file_url: bad3.error?.message, no_exec_tool: noExecTool } };
  }));
  checks.push(await check('audit.hash_chain', true, () => { const r = verifyChain(db); return { ok: r.ok, evidence: r }; }));

  // Bridge checks: mandatory only when the user approved the integration.
  const plan = planBridgeInstall();
  checks.push(await check('bridge.skill_files', requireBridge, () => {
    const rows = refreshInstalledInstances(db);
    const s = rows.find(r => r.kind === 'skill');
    return { ok: s?.health === 'files-ok', evidence: s || { missing: true } };
  }));
  checks.push(await check('bridge.mcp_config', requireBridge, () => {
    const rows = refreshInstalledInstances(db);
    const m = rows.find(r => r.kind === 'mcp');
    return { ok: m?.health === 'configured', evidence: m || { missing: true, claude_json: claudeJsonPath() } };
  }));
  checks.push(await check('bridge.idempotent_plan', requireBridge, () => ({ ok: plan.conflicts.length === 0 && plan.actions.every(a => a.state === 'already-applied'), evidence: { actions: plan.actions.map(a => ({ id: a.id, state: a.state })), conflicts: plan.conflicts } })));
  checks.push(await check('bridge.mcp_health_via_claude', requireBridge && Boolean(findClaudeBinary()), async () => {
    const bin = findClaudeBinary();
    if (!bin) return { status: 'blocked', evidence: { reason: 'Claude CLI not found' } };
    const h = await mcpHealth(bin);
    const s = h.servers.find(x => x.name === MCP_NAME);
    return { ok: Boolean(s?.healthy), evidence: { server: s || null, listed: h.servers.map(x => x.name) } };
  }));
  if (cleanSession) checks.push(await check('claude.clean_session', false, async () => {
    const r = await runClaudeJob({ prompt: 'Use the curi MCP tool search_resources with query "agent-native reverse engineering". Reply with only the id of the top result.', allowedTools: [`mcp__${MCP_NAME}__search_resources`], timeoutMs: 150000, maxTurns: 4, cwd: paths.backups });
    if (r.status === 'BLOCKED') return { status: 'blocked', evidence: r };
    return { ok: r.status === 'COMPLETED' && /morluto\/rea/i.test(String(r.result)), evidence: r };
  }));

  const mandatoryFail = checks.filter(c => c.mandatory && c.status !== 'pass');
  const optionalMissing = checks.filter(c => !c.mandatory && c.status !== 'pass');
  const verdict = mandatoryFail.length ? 'FAILED' : optionalMissing.length ? 'PARTIAL_READY' : 'READY';
  const receipt = { verdict, at: now(), require_bridge: requireBridge, passed: checks.filter(c => c.status === 'pass').length, total: checks.length, mandatory_failed: mandatoryFail.map(c => c.id), optional_unavailable: optionalMissing.map(c => `${c.id}:${c.status}`) };
  audit(db, actor, 'verify.run', null, receipt);
  const file = path.join(paths.logs, `verification-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...receipt, checks }, null, 2));
  return { ...receipt, checks, receipt_file: file };
}
