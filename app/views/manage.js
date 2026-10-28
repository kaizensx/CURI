import { h, relTime, fmtDate, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, linkBtn, status, badge, panel, pageHead, empty, notice, kv, table, toast, confirmDialog, dot, when } from '../lib/ui.js';
import { mount } from '../app.js';
import { runOperation } from './control.js';
import { withProgress } from '../lib/opmodal.js';

const CHECK_LABEL = {
  'db.integrity': 'Integridade da base de dados', 'registry.seed_preservation': 'Todos os URLs semente preservados', 'index.fts_consistency': 'Índice de pesquisa consistente',
  'search.smoke': 'Encaminhamento (REA, React Bits, Blender)', 'cli.smoke': 'CLI responde em JSON', 'mcp.live_stdio': 'MCP responde em direto', 'mcp.access_control': 'MCP recusa pedidos perigosos',
  'audit.hash_chain': 'Cadeia de auditoria íntegra', 'bridge.skill_files': 'Skill instalada e íntegra', 'bridge.mcp_config': 'Entrada MCP correta', 'bridge.idempotent_plan': 'Reaplicar não duplica nada',
  'bridge.mcp_health_via_claude': 'Claude Code liga ao MCP', 'claude.clean_session': 'Sessão Claude limpa usa o CURI',
};
const sevKind = s => (s.high ? 'fail' : s.medium ? 'blocked' : 'pass');

function scanResult(r, title) {
  return panel({ title: `Análise estática · ${title}`, meta: `${r.bytes} bytes` },
    h('div', { class: 'row', style: { marginBottom: '10px' } }, status(r.verdict === 'pass' ? 'pass' : r.verdict === 'review' ? 'blocked' : 'fail', r.verdict === 'pass' ? 'Sem achados' : r.verdict === 'review' ? 'Rever' : 'Bloquear'), h('span', { class: 'muted' }, 'Análise sem execução; conteúdo tratado como dados.')),
    r.findings.length ? table([{ label: 'Regra', cell: f => h('span', { class: 'mono' }, f.rule) }, { label: 'Severidade', cell: f => badge(f.severity, f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : '') }, { label: 'Linha', num: true, cell: f => f.line }, { label: 'Mensagem', cell: f => f.message }, { label: 'Excerto', cell: f => h('span', { class: 'mono' }, f.excerpt) }], r.findings) : null);
}

export async function skills() {
  const [inv, audit] = await Promise.all([api('inventory'), api('audit')]);
  const scanSlot = h('div');
  const byScope = inv.skills.reduce((m, s) => (m[s.scope] = (m[s.scope] || 0) + 1, m), {});
  const flagged = inv.skills.filter(s => s.security.high || s.security.medium).length;
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Gerir', title: 'Skills', sub: `Skills encontradas em ${inv.claude_home}. O CURI só altera a sua própria skill; as restantes são inspecionadas, nunca modificadas.` }),
    h('section', { class: 'panel kpis small' },
      kpiMini('Em disco', inv.skills.length), kpiMini('Âmbito user', byScope.user || 0), kpiMini('Via plugins', byScope.plugin || 0), kpiMini('Geridas pelo CURI', inv.skills.filter(s => s.managed_by_curi).length), kpiMini('Com achados', flagged)),
    h('div', { class: 'stack-lg reveal' },
      inv.limits.map(l => notice('info', l)),
      panel({ title: 'Instaladas', flush: true }, inv.skills.length ? h('div', { class: 'rows' }, inv.skills.map(s => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('skills')),
        h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name), h('div', { class: 't2 clamp1' }, s.description || 'sem descrição')),
        badge(s.scope), s.managed_by_curi ? badge('CURI', 'info') : null, status(sevKind(s.security), s.security.high ? `${s.security.high} alto` : s.security.medium ? `${s.security.medium} médio` : 'limpo'),
        btn('Analisar', async () => { const r = await withProgress(`A analisar ${s.name}`, () => api('scanSkill', { dir: s.dir }).then(x => ({ ...x, message: `${x.findings.length} achado(s).` }))); fill(scanSlot, scanResult(r, s.name)); scanSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, { kind: 'ghost sm', iconName: 'shield' }))))
        : empty('skills', 'Nenhuma skill em disco')),
      scanSlot,
      panel({ title: 'Conflitos entre âmbitos' }, inv.conflicts.length ? table([{ label: 'Nome', cell: c => c.name }, { label: 'Locais', cell: c => h('span', { class: 'mono' }, c.locations.join(' · ')) }], inv.conflicts) : h('div', { class: 'row muted' }, icon('check'), 'Sem conflitos de nome em disco.')),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Política de precedência' }, h('ol', { class: 'precedence' }, audit.precedence_policy.map(p => h('li', null, h('span', { class: 'rank num' }, p.rank), p.rule)))),
        panel({ title: 'Sobreposições em packs catalogados', meta: `${audit.skill_overlaps.length}`, flush: true }, table([{ label: 'Capacidade', cell: o => o.capability }, { label: 'Por precedência', cell: o => o.resources.map(r => r.name).join(' → ') }], audit.skill_overlaps.slice(0, 20))))));
}
const kpiMini = (l, v) => h('div', { class: 'kpi' }, h('span', { class: 'micro' }, l), h('div', { class: 'kpi-value num' }, v));

export async function mcp() {
  const inv = await api('inventory');
  const health = new Map();
  let tested = null;
  const grid = h('div', { class: 'conn-grid reveal' });
  const draw = () => fill(grid, ...(inv.mcp.length ? inv.mcp.map(s => {
    const hl = health.get(s.name);
    return h('article', { class: 'panel conn' }, h('div', { class: 'panel-body' },
      h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon('mcp')), h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name), h('div', { class: 't2' }, `${s.scope}${s.project ? ` · ${s.project}` : ''} · ${s.transport}`)),
        hl ? status(hl.healthy ? 'pass' : 'fail', hl.healthy ? 'Ligado' : 'Falhou') : badge(tested ? 'não listado' : 'configurado')),
      h('div', { class: 'mono conn-cmd selectable' }, [s.command, ...(s.args || [])].join(' ')),
      h('div', { class: 'row' }, s.env_keys.length ? s.env_keys.map(k => badge(`env ${k}`)) : h('span', { class: 'muted' }, 'sem variáveis de ambiente'), s.name === 'curi' ? badge('gerido pelo CURI', 'info') : null),
      hl && !hl.healthy ? notice('bad', hl.status) : null));
  }) : [panel({}, empty('mcp', 'Nenhum servidor MCP configurado'))]));
  draw();
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Gerir', title: 'Servidores MCP', sub: 'Configurado ≠ funcional. O teste arranca cada servidor tal como uma sessão Claude faria. Valores de variáveis de ambiente nunca são lidos — só os nomes.', actions: [
      btn('Testar ligações', async () => { await withProgress('A testar os servidores MCP', async () => { const r = await api('mcpHealth'); if (!r.available) return { ok: false, message: 'O Claude Code não está instalado.' }; tested = new Date().toISOString(); health.clear(); r.servers.forEach(s => health.set(s.name, s)); draw(); return `${r.servers.filter(s => s.healthy).length} de ${r.servers.length} ligados.`; }, { stage: 'O Claude Code está a arrancar cada servidor configurado…' }).catch(() => {}); }, { kind: 'primary', iconName: 'refresh' })] }),
    inv.mcp_duplicates.length ? notice('warn', `Possíveis duplicados: ${inv.mcp_duplicates.map(d => d.entries.join(' = ')).join(' · ')}`) : null,
    grid);
}

export async function bridge() {
  const [pf, plan, txs, drift, s] = await Promise.all([api('preflight'), api('bridgePlan'), api('transactions'), api('drift'), api('status')]);
  const results = h('div');
  const pending = plan.actions.filter(a => a.state !== 'already-applied');
  const toggles = pending.map(a => ({ a, input: h('input', { type: 'checkbox', role: 'switch', id: `b-${a.id}` }) }));
  const cs = h('input', { type: 'checkbox', role: 'switch', id: 'b-cs' });
  const integ = s.installed_by_curi;
  const lv = s.last_verification;
  const healthy = integ.length && integ.every(i => ['files-ok', 'configured'].includes(i.health)) && !drift.drift.length;

  const runVerify = async () => {
    const op = await runOperation('verify.run', { requireBridge: integ.length > 0, cleanSession: cs.checked }, cs.checked ? 'Verificação com pedido real ao Claude' : 'Verificação independente', { refresh: false });
    const v = op?.verification;
    if (!v?.checks) return;
    fill(results, panel({ title: 'Verificação independente', meta: `${v.passed}/${v.total} · ${v.verdict}`, flush: true },
      h('div', { class: 'rows' }, v.checks.map(c => h('details', { class: 'r check' }, h('summary', { class: 'row nowrap' }, h('span', { class: `check-ic ${c.status}` }, icon(c.status === 'pass' ? 'check' : c.status === 'blocked' ? 'lock' : 'x', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 't1' }, CHECK_LABEL[c.id] || c.id), h('div', { class: 't2 mono' }, `${c.id}${c.mandatory ? '' : ' · opcional'}`)), h('span', { class: 'muted num' }, `${c.ms} ms`), icon('chevronDown', 'sm')),
        h('pre', { class: 'evidence' }, JSON.stringify(c.evidence, null, 2))))),
      h('div', { class: 'panel-foot mono muted' }, v.receipt_file)));
  };

  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Gerir', title: 'Claude Bridge', sub: 'Uma skill compacta e um servidor MCP stdio só de leitura. Funcionam sem a app aberta — o Claude Code arranca o MCP diretamente.' }),
    h('section', { class: `panel bridge-hero ${healthy ? 'ok' : integ.length ? 'warn' : ''}` }, h('div', { class: 'panel-body' },
      h('div', { class: 'bh-status' }, h('span', { class: `result-ic ${healthy ? 'good' : integ.length ? 'warn' : ''}` }, icon(healthy ? 'check' : integ.length ? 'alert' : 'bridge', 'lg')),
        h('div', null, h('h3', null, healthy ? 'Integração ativa' : integ.length ? 'Integração precisa de atenção' : 'Integração não aplicada'),
          h('p', { class: 'muted' }, lv ? `Última verificação ${relTime(lv.ts)}: ${lv.passed}/${lv.total}` : 'Ainda sem verificação registada.'))),
      h('div', { class: 'bh-facts' },
        fact('Claude Code', pf.claude.version || 'não encontrado'), fact('Ligação', pf.claude.auth?.loggedIn === true ? 'ligado' : h('a', { href: '#/connections', class: 'ext' }, pf.claude.auth?.loggedIn === false ? 'não ligado — Ligar Claude' : 'desconhecida — ver Ligações')),
        fact('Protocolo MCP', 'stdio · 2024-11 → 2025-11'), fact('Perfil', h('span', { class: 'mono' }, pf.paths.claude_home))),
      h('div', { class: 'row' }, h('label', { class: 'row nowrap', for: 'b-cs' }, h('span', { class: 'switch' }, cs, h('span')), 'Incluir um pedido real ao Claude ', badge('consome uso', 'warn')), h('span', { class: 'spacer' }), btn('Executar verificação', runVerify, { kind: 'primary', iconName: 'shield' })))),
    h('div', { class: 'stack-lg reveal' },
      results,
      drift.drift.length ? notice('bad', `Drift: ${drift.drift.map(d => d.name).join(', ')} foi alterado fora do CURI. Não será sobrescrito automaticamente.`) : null,
      panel({ title: 'Estado observado', flush: true }, integ.length ? h('div', { class: 'rows' }, integ.map(i => h('div', { class: 'r' }, h('span', { class: 'itile' }, icon(i.kind === 'mcp' ? 'mcp' : 'skills')), h('div', { class: 'grow' }, h('div', { class: 't1' }, `${i.kind} · ${i.name}`), h('div', { class: 't2' }, `observado ${relTime(i.observed_at)}`)), status(i.health)))) : empty('bridge', 'Nada aplicado', 'Use a configuração guiada ou aprove as ações abaixo.')),
      panel({ title: 'Alterações propostas', meta: pending.length ? `${pending.length} pendente(s)` : 'em dia' },
        h('div', { class: 'stack' }, plan.actions.map(a => h('div', { class: 'row nowrap plan-row' }, status(a.state === 'already-applied' ? 'pass' : 'pending', a.state === 'already-applied' ? 'Aplicada' : a.state === 'update' ? 'Atualização' : 'Nova'), h('strong', null, a.id), badge(a.risk, 'warn'), h('span', { class: 'mono muted clamp1 grow' }, a.path || a.via || a.target))),
          plan.conflicts.map(c => notice('bad', `${c.action}: ${c.reason}`)),
          pending.find(a => a.preview) ? h('details', null, h('summary', { class: 'muted' }, 'Pré-visualizar SKILL.md'), h('pre', null, pending.find(a => a.preview).preview)) : null,
          toggles.length ? [toggles.map(({ a, input }) => h('label', { class: 'row nowrap', for: input.id }, h('span', { class: 'switch' }, input, h('span')), `Aprovo ${a.id}`)),
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Aplicar aprovadas', async () => {
              if (toggles.some(t => !t.input.checked)) { toast('Aprove as duas alterações: a integração aplica-as em conjunto.', 'bad'); return; }
              await runOperation('curi.integration', {}, 'Aplicar a integração Claude');
            }, { kind: 'primary', iconName: 'check' }))] : null)),
      panel({ title: 'Transações', flush: true }, table([
        { label: 'ID', cell: t => h('span', { class: 'mono' }, t.id) }, { label: 'Tipo', cell: t => t.kind }, { label: 'Estado', cell: t => status(t.status) }, { label: 'Criada', cell: t => when(t.created_at) },
        { label: '', cell: t => (t.status === 'committed' ? btn('Reverter', () => runOperation('curi.rollback', { tx: t.id }, `Reverter ${t.id}`), { kind: 'ghost sm danger', iconName: 'undo' }) : null) }], txs, { emptyText: 'Sem transações.' }))));
}
const fact = (l, v) => h('div', null, h('span', { class: 'micro' }, l), h('div', null, v));

export async function security() {
  const [a, inv] = await Promise.all([api('audit'), api('inventory')]);
  const area = h('textarea', { class: 'area', 'aria-label': 'Texto a analisar', placeholder: 'Cole um README, SKILL.md, descrição de MCP ou configuração de hooks…' });
  const out = h('div');
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Gerir', title: 'Segurança', sub: 'Conteúdo externo é tratado como dados não confiáveis. A análise estática não executa nada e nunca concede autoridade.' }),
    h('div', { class: 'grid cols-main reveal' },
      panel({ title: 'Analisar conteúdo' }, area, h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, '12 regras: prompt injection, pipe-to-shell, credenciais, hooks, persistência, unicode oculto…'), h('span', { class: 'spacer' }),
        btn('Analisar', async () => { if (!area.value.trim()) return; fill(out, scanResult(await api('scanText', { text: area.value }), 'texto colado')); }, { kind: 'primary', iconName: 'shield' })), out),
      panel({ title: 'Política em vigor' }, h('ul', { class: 'plain policy' }, [
        ['lock', 'Sem instalações silenciosas; cada ação de risco tem aprovação própria.'], ['mcp', 'MCP do CURI: sem shell, sem ficheiros, argumentos validados.'],
        ['shield', 'App: só 127.0.0.1, token, verificação de Host/Origin, CSP estrita, sem CORS.'], ['alert', 'Ferramentas ofensivas (pentest, RE) só contra alvos autorizados.'], ['activity', 'Telemetria desligada.']].map(([ic, t]) => h('li', null, icon(ic, 'sm'), t))))),
    h('div', { class: 'stack-lg', style: { marginTop: '16px' } },
      panel({ title: 'Recursos com notas de risco', meta: `${a.risks.length}`, flush: true }, table([{ label: 'Recurso', cell: r => h('a', { href: `#/resource/${encodeURIComponent(r.id)}` }, r.name) }, { label: 'Nota', cell: r => r.risk_notes }], a.risks)),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Skills locais', flush: true }, table([{ label: 'Skill', cell: s => s.name }, { label: 'Âmbito', cell: s => s.scope }, { label: 'Alto', num: true, cell: s => s.security.high }, { label: 'Médio', num: true, cell: s => s.security.medium }, { label: 'Baixo', num: true, cell: s => s.security.low }], inv.skills)),
        panel({ title: 'Orquestração (máx. 1 ativo)', flush: true }, table([{ label: 'Framework', cell: o => o.name }, { label: 'Precedência', num: true, cell: o => o.rank }], a.orchestration_frameworks.items))),
      panel({ title: 'Indisponíveis ou obsoletos', flush: true }, table([{ label: 'Recurso', cell: r => r.name }, { label: 'Estado', cell: r => status(r.status) }], a.unavailable_or_deprecated, { emptyText: 'Nenhum.' }))));
}
