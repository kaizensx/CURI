import { h, relTime, fmtDate, fmtInt, fill } from '../lib/dom.js';
import { icon, brandMark } from '../lib/icons.js';
import { api, btn, status, badge, panel, pageHead, empty, notice, kv, table, toast, meter, when, segmented } from '../lib/ui.js';
import { go, params, applyTheme, currentTheme, applyMotion, currentMotion } from '../app.js';
import { withProgress } from '../lib/opmodal.js';

export async function map() {
  const g = await api('gaps');
  const focus = params().get('d');
  const lvl = n => (n === 0 ? 0 : n === 1 ? 1 : n < 4 ? 2 : n < 8 ? 3 : 4);
  const byDomain = {};
  for (const c of g.capabilities) (byDomain[c.domain] ||= []).push(c);
  const domains = g.domains.sort((a, b) => b.distinct_resources - a.distinct_resources);
  const page = h('div', { class: 'page' },
    pageHead({ eyebrow: 'Descobrir', title: 'Mapa de capacidades', sub: `${g.capabilities.filter(c => c.resources).length} de ${g.capabilities.length} capacidades têm pelo menos um recurso. Intensidade = número de recursos; "lacuna" = menos de 2.` }),
    h('div', { class: 'row scale-legend' }, h('span', { class: 'micro' }, 'Recursos'), ['0', '1', '2–3', '4–7', '8+'].map((l, i) => h('span', { class: `swatch h${i}` }, l))),
    h('div', { class: 'domains reveal' }, domains.map((d, i) => h('section', { class: `panel domain ${focus === d.domain ? 'focus' : ''}`, id: `d-${d.domain}`, vars: { '--i': i } },
      h('header', { class: 'panel-head' }, h('h2', null, d.domain), h('span', { class: 'micro' }, `${d.distinct_resources} recursos · ${d.distinct_verified} verificados${d.gaps.length ? ` · ${d.gaps.length} lacunas` : ''}`)),
      h('div', { class: 'panel-body tiles' }, (byDomain[d.domain] || []).map(c => {
        const b = h('button', { type: 'button', class: `tile h${lvl(c.resources)}`, 'aria-label': `${c.label}: ${c.resources} recursos, ${c.verified} verificados` },
          h('span', { class: 'tile-l' }, c.label), h('span', { class: 'tile-n num' }, c.resources, c.resources < 2 ? h('em', null, 'lacuna') : null));
        b.addEventListener('click', () => go(`library?cap=${c.id}`));
        return b;
      }))))),
    panel({ title: 'Domínios fora do catálogo', meta: 'fatia independente do reconhecimento' }, h('div', { class: 'chips' }, g.open_domains_not_covered.map(d => h('button', { type: 'button', class: 'chip', onclick: () => go(`radar?intent=${encodeURIComponent(d)}`) }, icon('radar', 'sm'), d)))));
  if (focus) requestAnimationFrame(() => document.getElementById(`d-${focus}`)?.scrollIntoView({ block: 'center' }));
  return page;
}

export async function jobs() {
  const [events, scans, s] = await Promise.all([api('jobs', { limit: 300 }), api('scans'), api('status')]);
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Sistema', title: 'Tarefas e monitorização', sub: 'Não há serviços em segundo plano nem agendamentos: cada tarefa corre apenas quando pedida.' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Fornecedores e quotas', flush: true }, s.providers.length ? h('div', { class: 'rows' }, s.providers.map(p => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('git')), h('div', { class: 'grow' }, h('div', { class: 't1' }, p.provider), h('div', { class: 't2' }, `${p.detail || ''} · verificado ${relTime(p.checked_at)}`)),
        p.rate_limit ? h('div', { class: 'quota' }, h('div', { class: 'row' }, h('span', { class: 'micro' }, p.rate_limit.kind), h('span', { class: 'num' }, `${p.rate_limit.remaining}/${p.rate_limit.limit}`)), meter(p.rate_limit.remaining / p.rate_limit.limit, p.rate_limit.remaining < p.rate_limit.limit * 0.2 ? 'warn' : 'good', 'quota restante'), h('div', { class: 't2' }, `reset ${relTime(p.rate_limit.reset)}${p.rate_limit.authenticated ? ' · com token' : ' · sem token'}`)) : null,
        status(p.status)))) : empty('git', 'Nenhum fornecedor contactado ainda')),
      panel({ title: 'Descobertas', flush: true }, table([{ label: '#', num: true, cell: x => x.id }, { label: 'Modo', cell: x => x.mode }, { label: 'Estado', cell: x => status(x.status) }, { label: 'Resultados', num: true, cell: x => x.n }, { label: 'Início', cell: x => when(x.started_at) }, { label: 'Duração', cell: x => (x.finished_at ? `${Math.round((new Date(x.finished_at) - new Date(x.started_at)) / 1000)} s` : '—') }, { label: 'Erro', cell: x => x.error || '—' }], scans, { onRow: x => go('radar'), emptyText: 'Sem descobertas.' })),
      panel({ title: 'Eventos', meta: `${events.length}` }, h('div', { class: 'log tall', role: 'log' }, events.map(j => h('div', { class: j.level }, h('span', { class: 'muted' }, fmtDate(j.ts)), ` [${j.job}] ${j.step || ''} — ${j.message}`))))));
}

export async function audit() {
  const [log, approvals, txs] = await Promise.all([api('auditLog', { limit: 500 }), api('approvals'), api('transactions')]);
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Sistema', title: 'Auditoria', sub: 'Registo append-only com cadeia de hashes SHA-256: alterar uma entrada passada quebra a cadeia.' }),
    h('section', { class: `panel bridge-hero ${log.chain.ok ? 'ok' : 'bad'}` }, h('div', { class: 'panel-body bh-status' }, h('span', { class: `result-ic ${log.chain.ok ? 'good' : 'bad'}` }, icon(log.chain.ok ? 'lock' : 'alert', 'lg')),
      h('div', null, h('h3', null, log.chain.ok ? 'Cadeia íntegra' : `Cadeia quebrada na entrada ${log.chain.brokenAt}`), h('p', { class: 'muted' }, `${fmtInt(log.chain.checked)} entradas verificadas agora.`)))),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Aprovações', flush: true }, table([{ label: 'Ação', cell: a => h('span', { class: 'mono' }, a.action) }, { label: 'Risco', cell: a => badge(a.risk_class, 'warn') }, { label: 'Decisão', cell: a => status(a.decision) }, { label: 'Ator', cell: a => a.actor }, { label: 'Política', cell: a => a.policy_version }, { label: 'Quando', cell: a => when(a.created_at) }], approvals, { emptyText: 'Sem aprovações registadas.' })),
      panel({ title: 'Transações', flush: true }, table([{ label: 'ID', cell: t => h('span', { class: 'mono' }, t.id) }, { label: 'Estado', cell: t => status(t.status) }, { label: 'Manifesto', cell: t => h('details', null, h('summary', { class: 'muted' }, 'ver'), h('pre', null, JSON.stringify(t.manifest, null, 2))) }], txs, { emptyText: 'Sem transações.' })),
      panel({ title: 'Atividade', meta: `${log.entries.length} mais recentes`, flush: true }, table([{ label: '#', num: true, cell: e => e.id }, { label: 'Quando', cell: e => when(e.ts) }, { label: 'Ator', cell: e => e.actor }, { label: 'Ação', cell: e => h('span', { class: 'mono' }, e.action) }, { label: 'Alvo', cell: e => h('span', { class: 'mono' }, e.target || '—') }, { label: 'Hash', cell: e => h('span', { class: 'mono muted' }, e.hash.slice(0, 12)) }], log.entries))));
}

export async function settings() {
  const [p, pf] = await Promise.all([api('prefsGet'), api('preflight')]);
  const budget = h('input', { type: 'number', class: 'num-input', min: '0', max: '5000', value: String(p.github_budget), 'aria-label': 'Orçamento GitHub' });
  const policy = h('select', { class: 'select', 'aria-label': 'Política de instalação' }, [['minimal-global', 'Mínimo global (recomendado)'], ['catalog-only', 'Só catálogo']].map(([v, l]) => h('option', { value: v, selected: v === p.install_policy || null }, l)));
  const model = h('input', { type: 'checkbox', role: 'switch', id: 'pm', checked: p.model_analysis || null });
  const file = h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Ficheiro de importação', class: 'file' });
  const impOut = h('div');
  const readFile = async () => { if (!file.files[0]) throw new Error('Escolha um ficheiro primeiro.'); return JSON.parse(await file.files[0].text()); };
  const row = (t1, t2, ctl) => h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, t1), t2 ? h('div', { class: 't2' }, t2) : null), ctl);
  return h('div', { class: 'page narrow' },
    pageHead({ eyebrow: 'Sistema', title: 'Definições' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Aparência e movimento', flush: true }, h('div', { class: 'rows' },
        row('Tema', 'Segue o sistema por omissão.', segmented([['system', 'Sistema'], ['dark', 'Escuro'], ['light', 'Claro']], currentTheme(), v => applyTheme(v), 'Tema')),
        row('Movimento', 'Reduzido remove deslocações e entradas escalonadas; Desligado remove todas as animações (o estado nunca depende delas). A preferência "Reduzir movimento" do macOS é sempre respeitada.', segmented([['full', 'Completo'], ['reduced', 'Reduzido'], ['off', 'Desligado']], currentMotion(), v => applyMotion(v), 'Movimento')))),
      panel({ title: 'Integrações e controlo', flush: true }, h('div', { class: 'rows' },
        row('Ligações e credenciais', 'Claude Code, GitHub, Anthropic API, OpenAI, Google AI.', h('a', { class: 'btn sm', href: '#/connections' }, 'Abrir')),
        row('Automação e permissões', 'Modo de gestão, matriz de permissões, editores de confiança, trabalho de fundo.', h('a', { class: 'btn sm', href: '#/automation' }, 'Abrir')),
        row('Operações', 'Fila, aprovações e histórico de instalações.', h('a', { class: 'btn sm', href: '#/operations' }, 'Abrir')))),
      panel({ title: 'Descoberta e instalação', flush: true }, h('div', { class: 'rows' },
        row('Orçamento de pedidos GitHub por execução', 'Sem token: 60 pedidos/h e 10 pesquisas/min.', budget),
        row('Política de instalação', 'Mínimo global: só a skill e o MCP do CURI; tudo o resto sob demanda.', policy),
        row('Análise por modelo', 'Usa a sua conta Claude; desligado por omissão.', h('span', { class: 'switch' }, model, h('span'))),
        row('Telemetria', 'Sempre desligada.', badge('desligada')),
        row('Pesquisas agendadas', 'Exigiriam um agendador aprovado explicitamente.', badge('não ativadas')),
        h('div', { class: 'r' }, h('span', { class: 'spacer' }), btn('Guardar', async () => { await api('prefsSet', { github_budget: Number(budget.value), install_policy: policy.value, model_analysis: model.checked }); toast('Preferências guardadas', 'good'); }, { kind: 'primary' })))),
      panel({ title: 'Dados', flush: true }, h('div', { class: 'rows' },
        row('Dados CURI', h('span', { class: 'mono' }, pf.paths.curi_data)), row('Perfil Claude', h('span', { class: 'mono' }, pf.paths.claude_home)), row('MCP do utilizador', h('span', { class: 'mono' }, pf.paths.claude_json)),
        row('Exportar registo', 'JSON versionado (curi-registry-export v1) com URLs originais, evidência e snapshots.', btn('Exportar', () => withProgress('A exportar o registo', () => api('exportFile').then(r => `${r.count} recursos exportados para ${r.file}`), { stage: 'A escrever o ficheiro JSON…' }), { iconName: 'download' })),
        h('div', { class: 'r col' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Importar registo'), h('div', { class: 't2' }, 'Estados INSTALLED/CONFIGURED importados passam a NEEDS_VERIFICATION: instalação nunca é herdada.')),
          h('div', { class: 'row' }, file, btn('Simular', async () => { fill(impOut, kvResult(await api('importData', { data: await readFile(), dryRun: true }))); }, { iconName: 'search' }), btn('Importar', async () => { const data = await readFile(); const r = await withProgress('A importar o registo', () => api('importData', { data, dryRun: false }).then(x => ({ ...x, message: `${x.created} criados, ${x.merged} fundidos.` })), { stage: 'A validar e escrever…' }); fill(impOut, kvResult(r)); }, { kind: 'primary', iconName: 'upload' })), impOut)))));
}
const kvResult = r => kv(Object.entries(r).map(([k, v]) => [k, String(v)]));

export async function about() {
  const [s, b] = await Promise.all([api('status'), api('bootstrapState')]);
  const keys = [['⌘ K', 'Paleta de comandos'], ['⌘ 1–9', 'Navegar entre secções'], ['⌘ ,', 'Definições'], ['/', 'Focar a pesquisa da página'], ['⌘ R', 'Atualizar dados'], ['Esc', 'Fechar diálogos e menus'], ['Clique direito', 'Ações sobre um recurso'], ['Arrastar URL', 'Adicionar ao catálogo']];
  return h('div', { class: 'page narrow' },
    h('div', { class: 'about-mark' }, brandMark({ size: 64 }), h('img', { src: 'brand/curi-wordmark-on-dark.svg', alt: 'CURI', class: 'about-wordmark' })),
    pageHead({ eyebrow: 'Sistema', title: 'Sobre o CURI', sub: 'Claude Universal Resource Intelligence 3.1.0 — Core em Node (SQLite/FTS5), CLI, MCP stdio, skill Claude e app nativa Tauri.' }),
    h('div', { class: 'grid cols-2 reveal' },
      panel({ title: 'Atualizações', actions: btn('Verificar', async () => {
        const u = await api('updateCheck');
        const box = document.getElementById('upd');
        fill(box, u.status === 'available' ? h('div', { class: 'stack' }, notice('info', `Versão ${u.latest} disponível (tem ${u.current}).${u.has_checksums ? ' A release publica SHA256SUMS para verificar o download.' : ' Atenção: a release não publica SHA256SUMS.'}`), h('a', { class: 'btn primary', href: u.url, onclick: e => { e.preventDefault(); api('openExternal', { url: u.url }); } }, 'Abrir a página da release'))
          : notice(u.status === 'up_to_date' ? 'info' : 'warn', u.status === 'up_to_date' ? `Está na versão mais recente (${u.current}).` : u.detail));
      }, { kind: 'ghost sm', iconName: 'refresh' }) }, h('div', { id: 'upd' }, h('p', { class: 'muted', style: { margin: 0 } }, 'A app verifica a release mais recente no GitHub quando pede. As integrações (skills, MCP) atualizam-se em Integrações → Catálogo.'))),
      panel({ title: 'Estado' }, kv([['Configuração', status(b.state)], ['Schema', `v${s.schema_version}`], ['Recursos', fmtInt(s.resources)], ['Fontes verificadas', fmtInt(s.verified_sources)], ['Plataforma', 'macOS (primária)'], ['Claude Code testado', '2.1.309 – 2.1.312']])),
      panel({ title: 'Atalhos' }, h('dl', { class: 'keys' }, keys.flatMap(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)]))),
      panel({ title: 'Limitações conhecidas' }, h('ul', { class: 'plain' }, ['Skills sincronizadas da conta claude.ai não são visíveis em disco.', 'Velocidade de estrelas só existe com ≥2 snapshots reais na janela.', 'Sem GITHUB_TOKEN: 60 pedidos/h e 10 pesquisas/min.', 'Descrições do catálogo semente são "speculative" até verificação.', 'App com assinatura ad-hoc; distribuição exige notarização.'].map(t => h('li', null, icon('info', 'sm'), t)))),
      panel({ title: 'Recuperação' }, h('ul', { class: 'plain' }, [['curi doctor', 'diagnóstico'], ['curi drift', 'alterações externas'], ['curi rollback <tx>', 'reverter integração'], ['curi backup', 'cópia da base de dados'], ['npm test', 'suite de testes (core/)']].map(([c, d]) => h('li', null, icon('terminal', 'sm'), h('code', { class: 'mono' }, c), h('span', { class: 'muted' }, ` — ${d}`)))))));
}
