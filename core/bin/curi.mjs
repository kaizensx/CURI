#!/usr/bin/env node
// CURI Core CLI. Stable JSON with --json; side-effecting commands require explicit flags.
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.error(w); });

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {}, pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const JSON_OUT = Boolean(flags.json);

const HELP = `CURI — Claude Universal Resource Intelligence (Core CLI)

Uso: curi <comando> [opções]   (acrescente --json para saída máquina)

Consulta
  status                         Estado do registo, bootstrap e fornecedores
  doctor                         Preflight do dispositivo e da integração Claude
  search <intenção> [--limit N] [--type T] [--status S] [--capability C]
  suggest <tarefa>               Capacidades inferidas para uma tarefa
  list [--status S] [--type T] [--capability C]
  show <id>                      Registo completo de um recurso
  compare <id1> <id2> [...]      Comparação lado a lado
  gaps                           Auditoria de lacunas por domínio/capacidade
  audit                          Duplicados, sobreposições de skills, riscos
  inventory                      Skills/plugins/MCP existentes (só leitura)
  plan <id>                      Plano de instalação descritivo (não executa)
  scan <ficheiro>                Análise estática de segurança (SKILL.md, README...)
  velocity <owner/repo>          Crescimento de estrelas (só com snapshots reais)
  log [--limit N]                Registo de auditoria (cadeia de hashes)

Alterações ao registo
  add <url> [--note T] [--source S] [--pending]
  import-seeds [--dry-run]       Importar o catálogo inicial (idempotente)
  verify-source <id|--all-unverified> [--no-api] [--limit N]
  discover --mode task --intent "<texto>" | --mode frontier [--windows 7d,30d] [--max-queries N]
  candidates <scanId> [--new]    Candidatos de uma descoberta
  promote <candidateId>          Catalogar candidato (NEEDS_VERIFICATION, nunca instala)
  export [--out ficheiro]        Exportação JSON versionada
  import <ficheiro> [--apply]    Importação (dry-run por omissão)
  backup                         Cópia consistente da base de dados

Integração Claude (altera ~/.claude — exige aprovação explícita)
  bridge plan                    Mostra exatamente o que seria escrito
  bridge install --approve skill.write,mcp.register
  rollback <tx-id>               Reverte uma transação gerida pelo CURI
  drift                          Deteta alterações externas aos ficheiros geridos
  verify [--clean-session] [--no-bridge]   Verificação independente

Bootstrap / app
  bootstrap status|advance|pause|resume|cancel|rollback [--approve ...] [--network-verify] [--clean-session]
  app [--port N] [--no-open]     Abre a aplicação desktop (servidor local loopback)
  mcp                            Servidor MCP stdio (usado pelo Claude Code)
`;

function out(data, human) {
  if (JSON_OUT || !human) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else human(data);
}

async function main() {
  if (!cmd || cmd === 'help' || flags.help) { process.stdout.write(HELP); return; }
  if (cmd === 'mcp') { (await import('../src/mcp.mjs')).serveStdio(); return; }
  if (cmd === 'mcp-exec') {
    const { openDb } = await import('../src/db.mjs');
    const { execMcp } = await import('../src/installers.mjs');
    await execMcp(openDb(), pos[0]);
    return;
  }

  const fs = await import('node:fs');
  const { openDb } = await import('../src/db.mjs');
  const db = openDb();
  try {
    switch (cmd) {
      case 'status': {
        const { statusSummary } = await import('../src/status.mjs');
        return out(statusSummary(db), s => {
          console.log(`Registo: ${s.resources} recursos · ${s.source_urls} URLs de origem · ${s.verified_sources} verificados · schema v${s.schema_version}`);
          console.log(`Estados: ${Object.entries(s.by_status).map(([k, v]) => `${k}=${v}`).join(' ')}`);
          console.log(`Bootstrap: ${s.bootstrap.state}${s.bootstrap.updated_at ? ` (${s.bootstrap.updated_at})` : ''}`);
          console.log(`Integração gerida: ${s.installed_by_curi.map(i => `${i.kind}:${i.name}=${i.health}`).join(', ') || 'nenhuma'}`);
          if (s.last_verification) console.log(`Última verificação: ${s.last_verification.verdict} (${s.last_verification.passed}/${s.last_verification.total}) em ${s.last_verification.ts}`);
        });
      }
      case 'doctor': {
        const { preflight } = await import('../src/env.mjs');
        const { driftReport } = await import('../src/bridge.mjs');
        const { currentVersion } = await import('../src/db.mjs');
        const pf = await preflight();
        const integ = Object.values(db.prepare('PRAGMA quick_check').get())[0];
        return out({ ...pf, db: { integrity: integ, schema: currentVersion(db) }, drift: driftReport(db) }, d => {
          console.log(`SO: ${d.os.platform} ${d.os.macos || d.os.release} ${d.os.arch} · disco livre ${d.disk_free_gb} GB · GitHub ${d.network.github ? 'acessível' : 'inacessível'}`);
          console.log(`Node ${d.toolchain.node} · ${d.toolchain.git || 'git ausente'} · Rust ${d.toolchain.rust || 'ausente'}`);
          console.log(`Claude Code: ${d.claude.binary ? `${d.claude.version} (${d.claude.on_path ? 'no PATH' : 'embutido na app Claude'})` : 'NÃO encontrado'} · sessão CLI: ${d.claude.auth.loggedIn === true ? 'autenticada' : d.claude.auth.loggedIn === false ? 'NÃO autenticada' : 'desconhecida'}`);
          console.log(`BD: ${d.db.integrity} · schema v${d.db.schema} · drift: ${d.drift.drift.length ? d.drift.drift.map(x => x.name).join(', ') : 'nenhum'}`);
        });
      }
      case 'search': {
        const { search } = await import('../src/search.mjs');
        const q = pos.join(' ');
        if (!q) throw new Error('Indique a intenção: curi search "<texto>"');
        return out(search(db, q, { limit: Number(flags.limit) || 8, type: flags.type, status: flags.status, capability: flags.capability, tier: flags.tier, license: flags.license }), s => {
          console.log(`Intenção: ${s.intent.capabilities.map(c => c.id).join(', ') || '(sem capacidade reconhecida)'} · cobertura ${s.coverage}`);
          for (const r of s.results) console.log(`  ${r.score.toFixed(3)}  ${r.name}  [${r.type}/${r.status}${r.explanation.verified ? '/verificado' : ''}]  ${r.canonical_url}\n         ${r.explanation.matched_capabilities.join(', ') || 'texto'}${r.risk_notes ? `  ⚠ ${r.risk_notes}` : ''}`);
          console.log(s.advice);
        });
      }
      case 'suggest': {
        const { detectCapabilities } = await import('../src/taxonomy.mjs');
        return out(detectCapabilities(pos.join(' ')), r => r.forEach(c => console.log(`${c.id} (${c.domain}) ← ${c.matched.join(', ')}`)));
      }
      case 'list': {
        const { listResources } = await import('../src/registry.mjs');
        return out(listResources(db, { status: flags.status, type: flags.type, capability: flags.capability, tier: flags.tier }), rows => rows.forEach(r => console.log(`${r.status.padEnd(18)} ${r.type.padEnd(13)} ${r.name}  ${r.canonical_url}`)));
      }
      case 'show': {
        const { getResource } = await import('../src/registry.mjs');
        const r = getResource(db, pos[0]);
        if (!r) throw new Error(`Recurso inexistente: ${pos[0]}`);
        return out(r, null);
      }
      case 'compare': {
        const { compare } = await import('../src/search.mjs');
        return out(compare(db, pos), null);
      }
      case 'gaps': { const { gapAudit } = await import('../src/discover.mjs'); return out(gapAudit(db), null); }
      case 'audit': { const { resourceAudit } = await import('../src/audit.mjs'); return out(resourceAudit(db), null); }
      case 'inventory': { const { inventory } = await import('../src/env.mjs'); return out(inventory(), null); }
      case 'plan': { const { installPlan } = await import('../src/plans.mjs'); return out(installPlan(db, pos[0]), null); }
      case 'scan': { const { scanText } = await import('../src/security.mjs'); return out(scanText(fs.readFileSync(pos[0], 'utf8'), { source: pos[0] }), null); }
      case 'velocity': { const { starVelocity } = await import('../src/discover.mjs'); return out(['24h', '7d', '30d', '90d'].map(w => starVelocity(db, pos[0], w)), null); }
      case 'log': {
        const { verifyChain } = await import('../src/audit-log.mjs');
        return out({ chain: verifyChain(db), entries: db.prepare('SELECT id, ts, actor, action, target, details FROM audit_log ORDER BY id DESC LIMIT ?').all(Number(flags.limit) || 30) }, null);
      }
      case 'add': {
        const { addUrl } = await import('../src/registry.mjs');
        const r = addUrl(db, pos[0], { note: flags.note, source: flags.source || 'cli', actor: flags.source === 'claude' ? 'claude' : 'user', pending: Boolean(flags.pending) });
        return out(r, x => console.log(`${x.duplicate ? 'Já existia (avistamento registado)' : 'Adicionado'}: ${x.id} [${x.type}/${x.status}] capacidades: ${x.capabilities.map(c => c.id).join(', ') || '—'}`));
      }
      case 'import-seeds': { const { importSeeds } = await import('../src/registry.mjs'); const rep = importSeeds(db, undefined, { dryRun: Boolean(flags['dry-run']) }); if (!flags['dry-run']) { const { seedFacts } = await import('../src/facts.mjs'); rep.facts = seedFacts(db); } return out(rep, null); }
      case 'verify-source': {
        const { verifyResource } = await import('../src/github.mjs');
        const targets = flags['all-unverified'] ? db.prepare('SELECT id FROM resources WHERE last_verified IS NULL ORDER BY id LIMIT ?').all(Number(flags.limit) || 50).map(r => r.id) : [pos[0]];
        const results = [];
        for (const id of targets) { results.push(await verifyResource(db, id, { useApi: !flags['no-api'] })); if (!JSON_OUT) process.stderr.write('.'); }
        return out(results, rs => { console.log(); rs.forEach(r => console.log(`${r.id}: ${r.checks.map(c => `${c.kind}=${c.exists ?? c.status ?? c.error}`).join(' ')}`)); });
      }
      case 'discover': {
        const { discover } = await import('../src/discover.mjs');
        const r = await discover(db, { mode: flags.mode || 'task', intent: flags.intent || pos.join(' '), windows: flags.windows ? String(flags.windows).split(',') : undefined, maxQueries: Number(flags['max-queries']) || 6, onEvent: e => !JSON_OUT && process.stderr.write(`${e.level === 'error' ? '✗' : '·'} ${e.q.kind}: ${e.q.q}${e.error ? ` — ${e.error}` : ` (${e.n})`}\n`) });
        return out(r, x => {
          console.log(`Scan ${x.scanId}: ${x.status} · ${x.total} resultados · fatia independente ${(x.independentShare * 100).toFixed(0)}%`);
          for (const c of x.candidates.filter(c => !c.in_registry).slice(0, 15)) console.log(`  [${c.id}] ${c.full_name} ★${c.stars} score=${c.score?.total ?? 'n/d'} conf=${c.score?.confidence} ${c.decision}${c.reason ? ` (${c.reason})` : ''}\n        ${c.description?.slice(0, 120) || ''}`);
        });
      }
      case 'candidates': { const { listCandidates } = await import('../src/discover.mjs'); return out(listCandidates(db, Number(pos[0]), { onlyNew: Boolean(flags.new) }), null); }
      case 'promote': { const { promoteCandidate } = await import('../src/discover.mjs'); return out(promoteCandidate(db, Number(pos[0])), null); }
      case 'export': {
        const { exportRegistry } = await import('../src/registry.mjs');
        const data = exportRegistry(db);
        if (flags.out) { fs.writeFileSync(flags.out, JSON.stringify(data, null, 2)); return out({ written: flags.out, count: data.count }, x => console.log(`Exportados ${x.count} recursos para ${x.written}`)); }
        return out(data, null);
      }
      case 'import': { const { importRegistry } = await import('../src/registry.mjs'); return out(importRegistry(db, JSON.parse(fs.readFileSync(pos[0], 'utf8')), { dryRun: !flags.apply }), null); }
      case 'backup': {
        const { paths } = await import('../src/paths.mjs');
        const path = await import('node:path');
        const dest = path.join(paths.backups, `curi-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
        db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
        return out({ backup: dest }, x => console.log(`Backup: ${x.backup}`));
      }
      case 'bridge': {
        const b = await import('../src/bridge.mjs');
        if (pos[0] === 'plan') return out(b.planBridgeInstall(), p => {
          console.log(`Claude home: ${p.claude_home}\nClaude JSON: ${p.claude_json}\nCLI Claude: ${p.claude_binary || 'não encontrada'}`);
          for (const a of p.actions) console.log(`- ${a.id} [${a.risk}] ${a.state}: ${a.path || a.via || a.target}`);
          for (const c of p.conflicts) console.log(`! conflito ${c.action}: ${c.reason}`);
          console.log(`Não tocado: ${p.untouched.join('; ')}`);
        });
        if (pos[0] === 'install') return out(await b.applyBridgeInstall(db, { approve: flags.approve ? String(flags.approve).split(',') : [] }), null);
        throw new Error('Use: curi bridge plan | curi bridge install --approve skill.write,mcp.register');
      }
      case 'rollback': { const { rollback } = await import('../src/bridge.mjs'); return out(await rollback(db, pos[0]), null); }
      case 'drift': { const { driftReport } = await import('../src/bridge.mjs'); return out(driftReport(db), null); }
      case 'verify': {
        const { runVerification } = await import('../src/verify.mjs');
        const r = await runVerification(db, { requireBridge: !flags['no-bridge'], cleanSession: Boolean(flags['clean-session']), actor: 'user' });
        return out(r, x => {
          for (const c of x.checks) console.log(`${c.status === 'pass' ? '✓' : c.status === 'blocked' ? '◌' : '✗'} ${c.id}${c.mandatory ? '' : ' (opcional)'} — ${c.status} (${c.ms} ms)`);
          console.log(`Veredicto: ${x.verdict} · ${x.passed}/${x.total} · recibo ${x.receipt_file}`);
        });
      }
      case 'bootstrap': {
        const boot = await import('../src/bootstrap.mjs');
        const sub = pos[0] || 'status';
        let r;
        if (sub === 'status') r = boot.getState(db);
        else if (sub === 'advance') r = await boot.advance(db, { decisions: flags.approve !== undefined || flags['network-verify'] || flags['clean-session'] || flags.decide ? { approve: flags.approve && flags.approve !== true ? String(flags.approve).split(',') : [], networkVerify: Boolean(flags['network-verify']), cleanSession: Boolean(flags['clean-session']) } : undefined, onEvent: s => !JSON_OUT && console.error(`✓ ${s}`) });
        else if (['pause', 'resume', 'cancel'].includes(sub)) r = boot[sub](db);
        else if (sub === 'rollback') r = await boot.rollbackBootstrap(db);
        else throw new Error('bootstrap status|advance|pause|resume|cancel|rollback');
        return out(r, x => console.log(`Estado: ${x.state || x.state?.state} · passo ${x.step || ''}\n${JSON.stringify(x.data?.completed ? Object.keys(x.data.completed) : x, null, 0)}`));
      }
      case 'daemon': {
        // Background pass (LaunchAgent): recover interrupted work, run approved/auto operations, schedule observation.
        const ops = await import('../src/operations.mjs');
        await import('../src/installers.mjs');
        const { getPref, setPref, now } = await import('../src/db.mjs');
        const recovered = ops.recover(db);
        const { maintenancePass } = await import('../src/maintenance.mjs');
        const pass = await maintenancePass(db, { actor: 'agent' });
        const scheduled = pass.queued.map(q => q.op);
        const done = await ops.drain(db, { max: 25 });
        return out({ at: new Date().toISOString(), recovered, scheduled, suggestions: pass.suggestions.length, skipped: pass.skipped || null, ran: done.map(o => ({ id: o.id, kind: o.kind, status: o.status })) }, x => console.log(JSON.stringify(x)));
      }
      case 'ops': {
        const ops = await import('../src/operations.mjs');
        await import('../src/installers.mjs');
        const sub = pos[0] || 'list';
        if (sub === 'list') return out(ops.listOps(db, { status: flags.status }), rows => rows.forEach(o => console.log(`${o.id}  ${o.status.padEnd(18)} ${o.kind.padEnd(16)} ${o.resource || ''}`)));
        if (sub === 'enqueue') return out(await ops.enqueue(db, pos[1], flags.params ? JSON.parse(flags.params) : {}, { actor: flags.approved ? 'user-approved' : 'user' }), null);
        if (sub === 'run') return out(await ops.drain(db, { max: Number(flags.max) || 20 }), null);
        if (['approve', 'reject', 'cancel', 'retry'].includes(sub)) return out(ops[sub](db, pos[1]), null);
        throw new Error('ops list|enqueue <kind> [--params JSON] [--approved]|run|approve|reject|cancel|retry <id>');
      }
      case 'app': {
        const { startServer } = await import('../src/server.mjs');
        db.close();
        const s = await startServer({ port: Number(flags.port) || 0 });
        console.log(`CURI Desktop em ${s.url.replace(/#token=.*/, '')} (token local em ${(await import('../src/paths.mjs')).paths.uiToken})`);
        console.log(`Estado: ${s.launch.state}${s.launch.needs_onboarding ? ' — onboarding pendente' : ''}. Ctrl+C para terminar.`);
        if (!flags['no-open']) {
          const { spawn } = await import('node:child_process');
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
          spawn(opener, [s.url], { stdio: 'ignore', detached: true }).unref();
        }
        if (flags['print-url']) console.log(s.url);
        // Desktop shell: stop when the parent app closes our stdin (also on parent crash).
        if (flags['exit-on-stdin-close']) { process.stdin.resume(); process.stdin.on('close', async () => { await s.close(); process.exit(0); }); }
        return;
      }
      default:
        throw new Error(`Comando desconhecido: ${cmd}. Use "curi help".`);
    }
  } finally {
    if (cmd !== 'app') try { db.close(); } catch {}
  }
}

main().catch(e => {
  if (JSON_OUT) process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
  else console.error(`Erro: ${e.message}`);
  process.exit(1);
});
