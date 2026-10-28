// Library: every resource with its real kind, its real presence on this device, and the action that
// fits it. Resource sheet: what it is, how an agent uses it, where it already is, every working way to
// get it here, project usage, alternatives. Compare: a decision table, not a score.
import { h, fmtDate, relTime, compact, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toast, contextMenu, empty, notice, promptDialog } from '../lib/ui.js';
import { go, mount, params, compareTray } from '../app.js';
import { runOperation } from './control.js';
import { KIND_ICON, STATE_LABEL, stateChip, kindTile, where, runAction, actionButton, cmdLine, addToProject, personalPanel } from './common.js';

export const TYPE_ICON = { Skill: 'skills', Plugin: 'layers', MCP: 'mcp', Library: 'library', Framework: 'library', Tool: 'terminal', Documentation: 'info', Registry: 'search', Template: 'copy', Inspiration: 'sparkle' };
const KIND_ORDER = ['plugin', 'skill-pack', 'skill', 'mcp', 'cli', 'app', 'components', 'library', 'framework', 'reference'];
const KIND_PLURAL = { plugin: 'Plugins do Claude Code', 'skill-pack': 'Pacotes de skills', skill: 'Skills', mcp: 'Servidores MCP', cli: 'Linha de comando', app: 'Aplicações', components: 'Componentes de UI', library: 'Bibliotecas', framework: 'Frameworks', reference: 'Referências' };

export function resourceMenu(r) {
  return [
    { label: 'Abrir ficha', icon: 'chevron', run: () => go(`resource/${encodeURIComponent(r.id)}`) },
    { label: 'Abrir fonte no browser', icon: 'external', run: () => api('openExternal', { url: r.canonical_url }) },
    { label: 'Copiar URL', icon: 'copy', run: async () => { await navigator.clipboard.writeText(r.canonical_url); toast('URL copiado'); } },
    '-',
    { label: compareTray.has(r.id) ? 'Remover da comparação' : 'Adicionar à comparação', icon: 'compare', run: () => compareTray.toggle(r.id) },
    { label: 'Atualizar dados do projeto', icon: 'refresh', run: () => runOperation('resource.inspect', { id: r.id }, `Atualizar dados — ${r.name}`) },
  ];
}

function railItem(label, n, pressed, onclick, swatch) {
  const b = h('button', { type: 'button', class: 'rail-item', 'aria-pressed': String(pressed) }, swatch ? h('span', { class: 'sw', style: { background: swatch } }) : null, h('span', null, label), h('span', { class: 'n' }, n));
  b.addEventListener('click', onclick);
  return b;
}

const SORTS = [['smart', 'Relevância'], ['name', 'Nome'], ['stars', 'Mais estrelas'], ['updated', 'Atividade recente'], ['state', 'Estado']];
const VIEWS = [['all', 'Tudo'], ['here', 'Neste dispositivo'], ['ready', 'Pronto a instalar'], ['project', 'Para projetos'], ['reference', 'Referências'], ['fav', 'Favoritos'], ['hidden', 'Ocultos']];
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const DAY = 864e5;

// The one useful thing to do from a row, for every kind of resource.
async function quickAction(r, after) {
  if (!r.state && r.ready && r.kind !== 'reference') {
    const v = await api('resourceView', { id: r.id });
    const a = v.actions.primary || v.actions.install.find(x => !x.disabled && !x.op?.params?.option_id?.includes('context7'));
    if (a) return runAction(a, r.name, after);
  }
  if (r.has_project) {
    const v = await api('resourceView', { id: r.id });
    if (v.actions.project.length) return addToProject(r.name, v.actions.project).then(after);
  }
  if (r.state) return go(`resource/${encodeURIComponent(r.id)}`);
  return api('openExternal', { url: r.canonical_url });
}
const quickLabel = r => (!r.state && r.ready && r.kind !== 'reference' ? [r.kind === 'components' ? 'Dar ao agente' : 'Obter', 'download', 'primary']
  : r.has_project && !r.state ? ['Adicionar a projeto', 'plus', ''] : r.state ? ['Gerir', 'settings', 'ghost'] : ['Abrir site', 'external', 'ghost']);

export async function library() {
  const p = params();
  const [all, capMap, cols] = await Promise.all([api('library'), api('capabilityMap'), api('collections')]);
  const st = { view: p.get('view') || 'all', kind: p.get('kind') || '', domain: p.get('domain') || '', col: p.get('col') || '', origin: '', upkeep: '', q: p.get('q') || '', sort: lsGet('curi-lib-sort', 'smart'), layout: lsGet('curi-lib-layout', 'list'), limit: 60, sel: new Set() };
  const capDomain = new Map(capMap.capabilities.map(c => [c.id, c.domain]));
  const prep = list => { for (const r of list) r.domains = [...new Set(r.capabilities.map(c => capDomain.get(c)).filter(Boolean))]; };
  prep(all);
  const inView = (r, v = st.view) => (v === 'hidden' ? r.mine.hidden : !r.mine.hidden && (v === 'all' || (v === 'here' && ['installed', 'configured', 'account'].includes(r.state)) || (v === 'ready' && !r.state && r.ready) || (v === 'project' && ['library', 'framework', 'components'].includes(r.kind)) || (v === 'reference' && r.kind === 'reference') || (v === 'fav' && r.mine.fav)));
  const passes = r => inView(r) && (!st.kind || r.kind === st.kind) && (!st.domain || r.domains.includes(st.domain)) && (!st.col || (r.mine.collections || []).includes(st.col))
    && (!st.origin || (st.origin === 'github' ? r.gh_full_name : !r.gh_full_name))
    && (!st.upkeep || (st.upkeep === 'active' ? r.pushed_at && Date.now() - new Date(r.pushed_at) < 90 * DAY : r.pushed_at && Date.now() - new Date(r.pushed_at) > 365 * DAY));
  let ranked = null;
  const rail = h('aside', { class: 'rail', 'aria-label': 'Filtros' });
  const list = h('div', { 'aria-live': 'polite' });
  const count = h('span', { class: 'lib-count' });
  const chipsRow = h('div', { class: 'active-filters' });
  const bulk = h('div');
  const input = h('input', { type: 'search', id: 'page-search', value: st.q, placeholder: 'Descreva o que quer que o agente faça: "controlar o Blender", "testar o site", "alternativa a GSAP"', 'aria-label': 'Pesquisar na biblioteca' });
  const sortSel = h('select', { class: 'select', 'aria-label': 'Ordenar' }, SORTS.map(([v, l]) => h('option', { value: v, selected: st.sort === v || null }, l)));
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; lsSet('curi-lib-sort', st.sort); render(); });
  const layoutBtns = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Vista' });

  const STATE_ORDER = { installed: 0, configured: 1, account: 2 };
  const filtered = () => {
    let rows = all.filter(passes);
    if (ranked && st.sort === 'smart') { const pos = new Map(ranked.map((id, i) => [id, i])); return rows.filter(r => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)); }
    if (ranked) { const ok = new Set(ranked); rows = rows.filter(r => ok.has(r.id)); }
    const cmp = { name: (a, b) => a.name.localeCompare(b.name), stars: (a, b) => (b.stars ?? -1) - (a.stars ?? -1), updated: (a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''),
      state: (a, b) => (STATE_ORDER[a.state] ?? (a.ready ? 3 : 4)) - (STATE_ORDER[b.state] ?? (b.ready ? 3 : 4)) || a.name.localeCompare(b.name),
      smart: (a, b) => (Boolean(b.mine.fav) - Boolean(a.mine.fav)) || (Boolean(b.state) - Boolean(a.state)) || (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (b.stars ?? 0) - (a.stars ?? 0) };
    return rows.sort(cmp[st.sort] || cmp.smart);
  };
  const set = (k, v) => { st[k] = st[k] === v ? '' : v; st.limit = 60; render(); };
  const renderRail = () => {
    const n = fn => all.filter(r => inView(r) && fn(r)).length;
    const myCols = [...new Set([...cols.map(c => c.name), ...all.flatMap(r => r.mine.collections || [])])];
    fill(rail,
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Mostrar'), VIEWS.map(([v, l]) => { const c = all.filter(r => inView(r, v)).length; return v === 'hidden' && !c ? null : railItem(l, c, st.view === v, () => { st.view = v; st.limit = 60; render(); }); })),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro rail-head' }, 'Coleções', btn('', async () => { const name = await promptDialog({ title: 'Nova coleção', placeholder: 'ex.: Projeto cliente, Para testar', confirm: 'Criar' }); if (name?.trim()) { await api('collectionAdd', { name }); cols.push({ name: name.trim() }); render(); } }, { size: 'sm', kind: 'ghost', iconName: 'plus', title: 'Nova coleção' })),
        myCols.length ? myCols.map(c => railItem(c, all.filter(r => (r.mine.collections || []).includes(c)).length, st.col === c, () => set('col', c))) : h('p', { class: 'rail-empty' }, 'Junte recursos em coleções suas: selecione-os e escolha "Coleção".')),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Tipo'), KIND_ORDER.filter(k => k !== 'reference').map(k => [k, n(r => r.kind === k)]).filter(([, c]) => c).map(([k, c]) => railItem(KIND_PLURAL[k], c, st.kind === k, () => set('kind', k)))),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Área'), capMap.domains.map(d => [d, n(r => r.domains.includes(d.id))]).filter(([, c]) => c).sort((a, b) => b[1] - a[1]).map(([d, c]) => railItem(d.label, c, st.domain === d.id, () => set('domain', d.id)))),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Origem e manutenção'),
        railItem('GitHub', n(r => r.gh_full_name), st.origin === 'github', () => set('origin', 'github')), railItem('Sites', n(r => !r.gh_full_name), st.origin === 'web', () => set('origin', 'web')),
        railItem('Ativos (90 dias)', n(r => r.pushed_at && Date.now() - new Date(r.pushed_at) < 90 * DAY), st.upkeep === 'active', () => set('upkeep', 'active')),
        railItem('Parados há mais de 1 ano', n(r => r.pushed_at && Date.now() - new Date(r.pushed_at) > 365 * DAY), st.upkeep === 'stale', () => set('upkeep', 'stale'))));
  };
  const reload = async () => { const fresh = await api('library'); prep(fresh); all.splice(0, all.length, ...fresh); render(); };
  const toggleFav = async r => { r.mine = await api('mark', { id: r.id, patch: { fav: !r.mine.fav } }); render(); };

  const item = r => {
    const [ql, qi, qk] = quickLabel(r);
    const pick = h('button', { type: 'button', class: 'pick', 'aria-pressed': String(st.sel.has(r.id)), 'aria-label': `Selecionar ${r.name}` }, icon('check'));
    pick.addEventListener('click', e => { e.stopPropagation(); st.sel.has(r.id) ? st.sel.delete(r.id) : st.sel.add(r.id); render(); });
    const star = h('button', { type: 'button', class: `fav ${r.mine.fav ? 'on' : ''}`, 'aria-pressed': String(Boolean(r.mine.fav)), 'aria-label': r.mine.fav ? 'Tirar dos favoritos' : 'Favorito', title: 'Favorito' }, icon('star', 'sm'));
    star.addEventListener('click', e => { e.stopPropagation(); toggleFav(r); });
    const action = btn(ql, () => quickAction(r, reload), { size: 'sm', kind: qk, iconName: qi });
    const meta = h('div', { class: 'rmeta' }, where(r.where), r.state ? stateChip(r.state) : r.ready ? stateChip('available') : null);
    const sub = h('div', { class: 'rsub' }, r.stars != null ? h('span', null, icon('star', 'sm'), compact(r.stars)) : null, r.pushed_at ? h('span', null, relTime(r.pushed_at)) : null, r.language ? h('span', null, r.language) : null, (r.mine.collections || []).slice(0, 2).map(c => h('span', { class: 'mine-col' }, c)), r.mine.notes ? h('span', { title: r.mine.notes }, icon('info', 'sm'), 'nota') : null);
    const el = st.layout === 'grid'
      ? h('article', { class: `rcard2 ${st.sel.has(r.id) ? 'sel' : ''}`, tabindex: '0', role: 'listitem', 'aria-label': r.name },
        h('div', { class: 'top' }, kindTile(r.kind, Boolean(r.state)), h('div', { class: 'grow' }, h('strong', null, r.name), h('span', { class: 'k' }, r.kind_label)), star, pick),
        h('p', null, r.description || '—'), sub, h('div', { class: 'foot' }, meta, action))
      : h('div', { class: `rrow ${st.sel.has(r.id) ? 'sel' : ''}`, role: 'listitem', tabindex: '0', 'aria-label': `${r.name}, ${r.kind_label}` },
        pick, kindTile(r.kind, Boolean(r.state)),
        h('div', { class: 'rmain' }, h('div', { class: 'rname' }, h('strong', null, r.name), h('span', { class: 'k' }, r.kind_label)), h('div', { class: 'rdesc' }, r.description || '—'), sub),
        meta, h('div', { class: 'ract' }, star, action));
    const open = () => go(`resource/${encodeURIComponent(r.id)}`);
    el.addEventListener('click', e => { if (!e.target.closest('button')) open(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) open(); if (e.key === ' ' && e.target === el) { e.preventDefault(); pick.click(); } });
    el.addEventListener('contextmenu', e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [...resourceMenu(r), '-', { label: r.mine.fav ? 'Tirar dos favoritos' : 'Favorito', icon: 'star', run: () => toggleFav(r) }, { label: r.mine.hidden ? 'Mostrar' : 'Ocultar', icon: 'x', run: async () => { r.mine = await api('mark', { id: r.id, patch: { hidden: !r.mine.hidden } }); render(); } }]); });
    return el;
  };

  const renderBulk = () => {
    const ids = [...st.sel];
    const rows = all.filter(r => st.sel.has(r.id));
    const ready = rows.filter(r => !r.state && r.ready && r.kind !== 'reference');
    fill(bulk, ids.length ? h('div', { class: 'tray', role: 'region', 'aria-label': 'Seleção' },
      h('span', { class: 'names' }, `${ids.length} selecionado${ids.length > 1 ? 's' : ''}`),
      btn('Comparar', () => { compareTray.clear(); ids.slice(0, 5).forEach(id => compareTray.add(id)); go('compare'); }, { size: 'sm', iconName: 'compare', disabled: ids.length < 2 }),
      btn('Coleção', async () => { const name = await promptDialog({ title: `Juntar ${ids.length} a uma coleção`, body: cols.length ? `Existentes: ${cols.map(c => c.name).join(', ')}` : null, placeholder: 'nome da coleção', confirm: 'Juntar' }); if (!name?.trim()) return; for (const r of rows) r.mine = await api('mark', { id: r.id, patch: { collections: [...(r.mine.collections || []), name.trim()] } }); if (!cols.some(c => c.name === name.trim())) cols.push({ name: name.trim() }); toast(`${rows.length} em "${name.trim()}"`, 'good'); render(); }, { size: 'sm', iconName: 'layers' }),
      btn('Favoritos', async () => { for (const r of rows) r.mine = await api('mark', { id: r.id, patch: { fav: true } }); render(); }, { size: 'sm', iconName: 'star' }),
      ready.length ? btn(`Instalar ${ready.length}`, async () => { for (const r of ready) await quickAction(r, () => {}); st.sel.clear(); reload(); }, { size: 'sm', kind: 'primary', iconName: 'download' }) : null,
      btn('', () => { st.sel.clear(); render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Limpar seleção' })) : null);
  };
  const renderChips = () => {
    const act = [];
    if (st.view !== 'all') act.push([VIEWS.find(v => v[0] === st.view)[1], () => { st.view = 'all'; }]);
    if (st.kind) act.push([KIND_PLURAL[st.kind], () => { st.kind = ''; }]);
    if (st.domain) act.push([capMap.domains.find(d => d.id === st.domain)?.label, () => { st.domain = ''; }]);
    if (st.col) act.push([`Coleção: ${st.col}`, () => { st.col = ''; }]);
    if (st.origin) act.push([st.origin === 'github' ? 'GitHub' : 'Sites', () => { st.origin = ''; }]);
    if (st.upkeep) act.push([st.upkeep === 'active' ? 'Ativos' : 'Parados', () => { st.upkeep = ''; }]);
    fill(chipsRow, act.length ? [...act.map(([l, clear]) => { const b = h('button', { type: 'button', class: 'fchip' }, l, icon('x', 'sm')); b.addEventListener('click', () => { clear(); render(); }); return b; }),
      btn('Limpar filtros', () => { Object.assign(st, { view: 'all', kind: '', domain: '', col: '', origin: '', upkeep: '' }); render(); }, { size: 'sm', kind: 'ghost' })] : null);
  };
  const render = () => {
    renderRail(); renderChips(); renderBulk();
    fill(layoutBtns, [['list', 'list', 'Lista'], ['grid', 'grid', 'Grelha']].map(([v, ic, l]) => { const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.layout === v), title: l }, icon(ic, 'sm')); b.addEventListener('click', () => { st.layout = v; lsSet('curi-lib-layout', v); render(); }); return b; }));
    const rows = filtered();
    count.textContent = `${rows.length} recurso${rows.length === 1 ? '' : 's'}`;
    fill(list, rows.length ? h('div', { class: st.layout === 'grid' ? 'rgrid' : 'rlist', role: 'list' }, rows.slice(0, st.limit).map(item))
      : empty('search', 'Nada com estes filtros', ranked ? 'Nenhum recurso do catálogo corresponde. O Descobrir procura no GitHub.' : 'Experimente outra área ou tipo.', ranked ? btn('Procurar no GitHub', () => go(`discover?intent=${encodeURIComponent(st.q)}`), { iconName: 'radar' }) : null),
      rows.length > st.limit ? h('div', { class: 'more-row' }, btn(`Mostrar mais ${Math.min(60, rows.length - st.limit)}`, () => { st.limit += 60; render(); }, { kind: 'ghost' })) : null);
  };
  let t, seq = 0;
  const search = async () => {
    st.q = input.value.trim();
    const my = ++seq;
    if (st.q.length < 2) { ranked = null; render(); return; }
    const r = await api('search', { query: st.q, limit: 120 }).catch(() => null);
    if (my !== seq) return;
    ranked = r ? r.results.map(x => x.id) : null;
    render();
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 160); });
  if (st.q) search(); else render();
  const here = all.filter(r => ['installed', 'configured', 'account'].includes(r.state)).length;
  const ready = all.filter(r => !r.state && r.ready).length;
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Biblioteca'), h('p', null, `${all.length} recursos para os seus agentes: ${here} já estão aqui ou na sua conta, ${ready} instalam-se com um clique e os restantes usam-se em projetos ou como referência.`)),
      h('div', { class: 'actions' }, btn('Adicionar URL', () => window.__curiMenu('add-url-dialog'), { kind: 'ghost', iconName: 'plus' }))),
    h('div', { class: 'lib' }, rail, h('div', null,
      h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input), sortSel, layoutBtns, count),
      chipsRow, list)),
    bulk);
}

// ---------- Resource sheet ----------
const EV = { registry: 'confirmado no registo', curated: 'revisto', manifest: 'declarado pelo projeto', documented: 'documentado' };
const METHOD = { plugin: 'Plugin do Claude Code', skill: 'Skill do Claude Code', mcp: 'Servidor MCP no Claude Code', package: 'Gestor de pacotes', download: 'Instalador oficial' };
const TYPE_PT = { bin: 'Executável', app: 'Aplicação', brew: 'Homebrew', cask: 'Homebrew Cask', npm: 'npm global', uv: 'uv tool', pipx: 'pipx', pip: 'Python (pip)', cargo: 'Cargo', winget: 'WinGet', scoop: 'Scoop', flatpak: 'Flatpak', mcp: 'Servidor MCP', plugin: 'Plugin', skill: 'Skill', 'account-skill': 'Skill da conta', dir: 'Pasta', env: 'Variável' };

export async function resource(id) {
  const v = await api('resourceView', { id });
  if (!v) return h('div', { class: 'page' }, empty('alert', 'Recurso não encontrado', id));
  const { resource: r, profile: pf, presence: pr, actions: A, facts: f } = v;
  const after = () => mount();
  const sub = [pf.kind_label, r.gh_full_name?.split('/')[0], f?.license && f.license !== 'none' ? f.license : null].filter(Boolean);
  const head = h('header', { class: 'sheet-head' }, kindTile(pf.kind, Boolean(pr.state)),
    h('div', null, h('h1', null, r.name), h('div', { class: 'sub' }, sub.map(s => h('span', null, s)), stateChip(v.state))),
    h('div', { class: 'row' }, btn('', () => { compareTray.toggle(r.id); toast(compareTray.has(r.id) ? 'Na comparação' : 'Fora da comparação'); }, { kind: 'ghost', iconName: 'compare', title: 'Comparar' }),
      btn('', e => contextMenu(e.clientX, e.clientY, resourceMenu(r)), { kind: 'ghost', iconName: 'dots', title: 'Mais' })));

  // Action bar: the one thing to do next, then management, then documentation.
  const lead = A.primary ? null : pr.state ? 'Está pronto a usar.' : pf.kind === 'reference' ? 'Referência para consulta.' : null;
  const bar = h('div', { class: 'actionbar' },
    A.primary ? actionButton(A.primary, r.name, after, { kind: 'primary' }) : !pr.state && A.project.length ? btn('Adicionar a um projeto', () => addToProject(r.name, A.project).then(after), { kind: 'primary', iconName: 'plus' }) : lead ? h('span', { class: 'lead' }, lead) : null,
    ...A.manage.slice(0, 4).map(a => actionButton(a, r.name, after, { kind: 'ghost' })),
    h('span', { class: 'grow' }),
    ...A.docs.map(a => btn(a.label, () => runAction(a, r.name), { kind: 'ghost', iconName: 'external' })));

  const presence = pr.found.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, pr.found.map(x => h('li', null, icon(x.type === 'mcp' ? 'mcp' : x.type === 'app' ? 'grid' : x.type.includes('skill') ? 'skills' : x.type === 'plugin' ? 'layers' : 'terminal', 'sm'),
    h('div', { class: 'grow' }, h('div', null, `${TYPE_PT[x.type] || x.type} · `, h('span', { class: 'mono' }, x.name)), h('div', { class: 't2' }, [x.agent_label, x.version, x.scope && !['system', 'user'].includes(x.scope) ? x.scope : null, x.managed_by === 'curi' ? 'gerido pelo CURI' : x.managed_by === 'account' ? 'gerido pela conta' : 'instalado fora do CURI'].filter(Boolean).join(' · '))),
    x.enabled === false ? h('span', { class: 'state reference' }, 'Desativado') : null)))) : null;

  const options = A.install.length ? h('div', { class: 'box' }, A.install.map(a => h('div', { class: 'opt' },
    h('div', null, h('div', { class: 't' }, a.label), h('div', { class: 's' }, [a.sub, a.evidence ? EV[a.evidence] : null, a.missing ? `falta ${a.missing.join(', ')}` : null, a.secrets?.length ? `chave: ${a.secrets.join(', ')}` : null, a.auth === 'oauth' ? 'autenticação OAuth no Claude Code' : null, a.scripts ? 'inclui scripts' : null].filter(Boolean).join(' · '))),
    actionButton({ ...a, label: a.prereq && a.disabled ? a.label : a.op?.kind === 'mcp.add' ? 'Ativar' : a.op?.kind === 'package.install' ? 'Instalar' : a.op?.kind === 'plugin.install' ? 'Instalar' : a.op?.kind === 'skill.install' ? 'Instalar' : a.label }, r.name, after, { kind: a === A.primary ? 'primary' : '' }),
    a.setup?.length ? h('ol', { class: 'steps' }, a.setup.map(s => h('li', null, s))) : null))) : null;

  const project = A.project.length ? h('div', { class: 'stack' },
    h('div', { class: 'row' }, btn('Adicionar a um projeto', () => addToProject(r.name, A.project).then(after), { kind: A.primary || pr.state ? '' : 'primary', iconName: 'plus' }), h('span', { class: 'muted small' }, 'ou copie o comando:')),
    A.project.map(c => cmdLine(c.command))) : null;
  const mine = await personalPanel(r.id, v.mine || {}, (m, refresh) => { if (refresh) mount(); });
  const assist = A.assist.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, A.assist.map(a => h('li', null, icon('info', 'sm'), h('div', { class: 'grow' }, h('div', null, a.label), a.hint ? h('div', { class: 't2' }, a.hint) : null), btn('Abrir', () => runAction(a, r.name), { size: 'sm', iconName: 'external' }))))) : null;

  const capsBox = v.capabilities?.length ? h('div', { class: 'capchips' }, v.capabilities.map(c => h('a', { class: 'capchip', href: `#/capabilities?all=1&focus=${encodeURIComponent(c.id)}` }, c.label))) : null;
  const dl = [];
  const fact = (k, val) => { if (val != null && val !== '') dl.push(h('dt', null, k), h('dd', null, val)); };
  if (f) {
    fact('Estrelas', f.stars != null ? compact(f.stars) : null);
    fact('Última alteração', f.pushed_at ? relTime(f.pushed_at) : null);
    fact('Última versão', f.latest_release ? `${f.latest_release.tag} · ${fmtDate(f.latest_release.published_at, { dateStyle: 'medium' })}` : null);
    fact('Licença', f.license);
    fact('Linguagem', f.language);
    for (const [k, list] of Object.entries(f.packages || {})) fact(k === 'pypi' ? 'PyPI' : k === 'cask' ? 'Homebrew Cask' : k === 'brew' ? 'Homebrew' : k, list.map(x => `${x.name} ${x.version || ''}`).join(', '));
    if (f.skills) fact('Skills', `${f.skills}${f.internal_skills ? ` (+${f.internal_skills} internas do repositório)` : ''}`);
    if (f.plugins) fact('Plugins', f.plugins);
    if (f.archived) fact('Estado', 'Arquivado');
    fact('Dados de', `${f.source === 'web' ? 'site' : 'GitHub'} · ${relTime(f.inspected_at)}`);
  }
  const alts = v.alternatives.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, v.alternatives.map(a => h('li', null, icon(KIND_ICON[a.kind] || 'info', 'sm'),
    h('a', { class: 'grow', href: `#/resource/${encodeURIComponent(a.id)}` }, h('div', null, a.name), h('div', { class: 't2' }, a.related ? 'Funciona em conjunto' : `${Math.round(a.overlap * 100)}% das capacidades em comum`)),
    ['INSTALLED', 'CONFIGURED'].includes(a.status) ? stateChip('installed') : null))),
    h('div', { style: { padding: '8px 10px 10px' } }, btn('Comparar com estes', () => { compareTray.clear(); compareTray.add(r.id); v.alternatives.slice(0, 3).forEach(a => compareTray.add(a.id)); go('compare'); }, { kind: 'ghost', size: 'sm', iconName: 'compare' }))) : null;

  const sec = (title, meta, node) => (node ? [h('div', { class: 'sec' }, h('h2', null, title), meta ? h('span', { class: 'meta' }, meta) : null), node] : []);
  return h('div', { class: 'page' }, head, bar,
    h('div', { class: 'sheet' },
      h('div', null,
        ...sec('O que é', null, h('div', { class: 'stack' }, h('p', { class: 'prose' }, r.description || f?.description || 'Sem descrição verificada.'), h('p', { class: 'prose dim' }, pf.agent_use), pf.notes ? notice('info', pf.notes) : null, r.risk_notes ? notice('warn', r.risk_notes) : null)),
        ...sec('Neste dispositivo', pr.found.length ? `${pr.found.length} ocorrência${pr.found.length > 1 ? 's' : ''}` : null, presence || h('p', { class: 'prose dim' }, v.device.scanned_at ? `Não foi encontrado na última deteção (${relTime(v.device.scanned_at)}).` : 'Ainda não foi feita uma deteção.')),
        ...sec(pr.state ? 'Outras formas de o ter' : 'Instalar ou ativar', A.install.length ? 'cada opção corre visível, com progresso e verificação' : null, options),
        ...sec('Gerir noutro sítio', null, assist),
        ...sec('Usar num projeto', 'execute na pasta do projeto', project)),
      h('div', null,
        ...sec('Seu', 'só neste dispositivo', mine),
        ...sec('Factos', null, dl.length ? h('div', { class: 'box pad' }, h('dl', { class: 'facts' }, dl)) : h('p', { class: 'prose dim' }, 'Sem dados de inspeção.')),
        ...sec('Capacidades', null, capsBox),
        ...sec('Alternativas e complementos', null, alts))));
}

// ---------- Compare ----------
export async function compare() {
  const linked = params().get('ids');
  if (linked) { compareTray.clear(); linked.split(',').slice(0, 5).forEach(id => compareTray.add(id)); }
  const ids = [...compareTray.ids];
  if (ids.length < 2) return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Comparar'))),
    empty('compare', 'Escolha pelo menos dois recursos', 'Na Biblioteca, passe o rato por uma linha e marque a caixa à esquerda; ou abra uma ficha e use "Comparar com estes".', btn('Ir para a Biblioteca', () => go('library'), { kind: 'primary' })));
  const p = params();
  const input = h('input', { type: 'search', value: p.get('use') || '', placeholder: 'Para quê? ex.: "testar o meu site no browser"', 'aria-label': 'Caso de uso' });
  const out = h('div');
  const load = async () => {
    const r = await api('compareDecision', { ids, useCase: input.value.trim() });
    const it = r.items;
    const rowH = (label, fn) => h('tr', null, h('th', { scope: 'row' }, label), it.map(x => h('td', null, fn(x))));
    const ul = list => (list?.length ? h('ul', null, list.map(s => h('li', null, s))) : h('span', { class: 'muted' }, '—'));
    fill(out,
      r.guidance.length ? h('ul', { class: 'guidance' }, r.guidance.map(g => h('li', { class: g.tone || '' }, icon(g.tone === 'warn' ? 'alert' : 'arrow', 'sm'), h('span', null, g.text)))) : null,
      h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Critério')), it.map(x => h('th', { scope: 'col' }, h('div', { class: 'colhead' },
          h('a', { href: `#/resource/${encodeURIComponent(x.id)}` }, h('strong', null, x.name)), h('span', { class: 'muted' }, x.kind_label),
          h('div', { class: 'row' }, x.presence.state ? stateChip(x.presence.state) : btn('Ver opções', () => go(`resource/${encodeURIComponent(x.id)}`), { size: 'sm', kind: 'primary', iconName: 'download' }),
            btn('', () => { compareTray.delete(x.id); mount(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Retirar' }))))))),
        h('tbody', null,
          rowH('O que faz', x => x.description || '—'),
          rowH('Como o agente o usa', x => x.agent_use),
          r.use_case ? rowH(`Para "${r.use_case}"`, x => (x.matches_use_case?.length ? x.matches_use_case.join(', ') : h('span', { class: 'muted' }, 'não cobre diretamente'))) : null,
          rowH('Só este oferece', x => ul(x.unique)),
          rowH('Neste dispositivo', x => (x.presence.state ? `${STATE_LABEL[x.presence.state]}${x.presence.where.length ? ` · ${x.presence.where.join(', ')}` : ''}` : 'Não')),
          rowH('Instalação', x => h('div', null, h('div', null, x.install.text), x.install_method ? h('div', { class: 'muted' }, x.install_method) : null, x.steps.length ? ul(x.steps) : null)),
          rowH('Dependências', x => ul(x.deps)),
          rowH('Segurança', x => ul(x.security)),
          rowH('Editor', x => (x.publisher ? `${x.publisher.name}${x.publisher.trusted ? ' · de confiança' : ''}` : '—')),
          rowH('Manutenção', x => (x.maintenance ? `${x.maintenance.state}${x.maintenance.pushed_days != null ? ` · há ${x.maintenance.pushed_days} dias` : ''}${x.maintenance.release ? ` · ${x.maintenance.release}` : ''}${x.maintenance.stars != null ? ` · ${compact(x.maintenance.stars)} ★` : ''}` : '—')),
          rowH('Licença', x => x.license),
          it.some(x => x.use_when) ? rowH('Quando escolher', x => x.use_when || '—') : null,
          it.some(x => x.avoid_when) ? rowH('Quando evitar', x => x.avoid_when || '—') : null))));
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  await load();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Comparar'), h('p', null, 'Diferenças concretas para decidir: o que cada um faz, o que só ele faz, quanto custa pô-lo a funcionar aqui, riscos e manutenção. Sem pontuações arbitrárias.')),
      h('div', { class: 'actions' }, btn('Limpar', () => { compareTray.clear(); go('library'); }, { kind: 'ghost' }))),
    h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input)), out);
}
