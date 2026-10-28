// Discover: GitHub projects judged by what they would let an agent do (interface × domain), not by
// popularity alone. Sources: on-demand searches, saved searches (optionally automatic), the frontier
// sweep and the user's own stars. Everything is filterable; noise stays inspectable with its reason.
import { h, fill, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, toast, notice } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runOperation } from './control.js';

const IFACE = { mcp: 'Servidor MCP', plugin: 'Plugin', skill: 'Skill', 'computer-use': 'Controlo de browser/ecrã', cli: 'Linha de comando', 'scriptable-app': 'App programável', api: 'API/SDK', library: 'Biblioteca', ui: 'Componentes de UI' };
const SORTS = [['score', 'Mais úteis para agentes'], ['stars', 'Mais estrelas'], ['recent', 'Atividade recente'], ['new', 'Mais novos']];
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export async function discoverView() {
  const p = params();
  const [cands, gh, saved] = await Promise.all([api('candidatesAll', { limit: 1500 }), api('connections').then(l => l.find(x => x.provider === 'github')).catch(() => null), api('savedSearches')]);
  const seen = new Map();
  for (const c of cands) if (!seen.has(c.full_name)) seen.set(c.full_name, c);
  const all = [...seen.values()];
  const prefs = lsGet('curi-discover', { min: 40, sort: 'score', iface: [], domain: '', emerging: false, hideKnown: true });
  const st = { tab: p.get('tab') || 'relevant', q: '', sel: new Set(), limit: 60, ...prefs };
  const persist = () => lsSet('curi-discover', { min: st.min, sort: st.sort, iface: st.iface, domain: st.domain, emerging: st.emerging, hideKnown: st.hideKnown });
  const connected = gh?.status === 'connected';
  const refresh = () => location.reload();
  const sc = c => c.score?.agent?.score ?? 0;

  const inTab = (c, t = st.tab) => (t === 'filtered' ? c.decision === 'filtered' : t === 'stars' ? c.query_kind === 'stars' && c.decision !== 'filtered' : t === 'decided' ? ['promoted', 'rejected'].includes(c.decision) : c.decision === 'candidate');
  const passes = c => inTab(c) && (st.tab === 'filtered' || st.tab === 'decided' || ((!st.hideKnown || !c.in_registry) && sc(c) * 100 >= st.min))
    && (!st.iface.length || st.iface.includes(c.score?.agent?.interface)) && (!st.domain || (c.score?.agent?.domains || []).includes(st.domain)) && (!st.emerging || c.score?.agent?.emerging)
    && (!st.q || `${c.full_name} ${c.description || ''}`.toLowerCase().includes(st.q.toLowerCase()));
  const order = { score: (a, b) => sc(b) - sc(a), stars: (a, b) => (b.stars || 0) - (a.stars || 0), recent: (a, b) => (b.gh_pushed_at || '').localeCompare(a.gh_pushed_at || ''), new: (a, b) => (b.gh_created_at || '').localeCompare(a.gh_created_at || '') };

  const input = h('input', { type: 'search', id: 'page-search', value: p.get('intent') || '', placeholder: 'O que quer que um agente consiga fazer? ex.: "editar ficheiros CAD", "transcrever reuniões"', 'aria-label': 'Necessidade a procurar no GitHub' });
  const runSearch = (q = input.value.trim()) => { if (q.length < 3) { toast('Descreva a necessidade em poucas palavras.', 'bad'); return null; } return runOperation('discover', { mode: 'task', intent: q }, `Procurar no GitHub: ${q}`, { refresh: false }).then(refresh); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  const savedBox = h('div', { class: 'saved' });
  const renderSaved = list => fill(savedBox, list.length ? list.map(s => h('span', { class: 'saved-chip' },
    h('button', { type: 'button', class: 'go', title: 'Procurar de novo' }, icon('radar', 'sm'), s.intent),
    h('button', { type: 'button', class: `auto ${s.auto ? 'on' : ''}`, title: s.auto ? 'Corre sozinha na manutenção (carregue para desligar)' : 'Correr sozinha na manutenção' }, icon('clock', 'sm')),
    h('button', { type: 'button', class: 'rm', title: 'Esquecer' }, icon('x', 'sm')))) : null);
  savedBox.addEventListener('click', async e => {
    const chip = e.target.closest('.saved-chip'); if (!chip) return;
    const s = saved[[...savedBox.children].indexOf(chip)];
    if (e.target.closest('.go')) return runSearch(s.intent);
    if (e.target.closest('.auto')) { saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: s.intent, auto: !s.auto })); toast(s.auto ? 'Já não corre sozinha' : 'Vai correr sozinha na manutenção automática', 'good'); }
    if (e.target.closest('.rm')) saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: s.intent, remove: true }));
    renderSaved(saved);
  });
  renderSaved(saved);

  const filters = h('div', { class: 'dfilters' });
  const listEl = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Origem' });
  const bulk = h('div');
  const allDomains = [...new Set(all.flatMap(c => c.score?.agent?.domains || []))].sort();

  const row = c => {
    const a = c.score?.agent || {};
    const [owner, name] = c.full_name.split('/');
    const open = !['promoted', 'rejected'].includes(c.decision) && !c.in_registry;
    const pick = open ? h('button', { type: 'button', class: 'pick', 'aria-pressed': String(st.sel.has(c.id)), 'aria-label': `Selecionar ${name}` }, icon('check')) : h('span');
    if (open) pick.addEventListener('click', () => { st.sel.has(c.id) ? st.sel.delete(c.id) : st.sel.add(c.id); render(); });
    return h('article', { class: `cand ${st.sel.has(c.id) ? 'sel' : ''}` },
      pick,
      h('div', { class: 'body' },
        h('div', { class: 'nm' }, h('strong', null, name), h('span', { class: 'own' }, owner), c.in_registry ? h('span', { class: 'state installed' }, 'No catálogo') : null, c.decision === 'promoted' ? h('span', { class: 'state installed' }, 'Catalogado') : null, c.decision === 'rejected' ? h('span', { class: 'state reference' }, 'Rejeitado') : null, c.query_kind === 'stars' ? h('span', { class: 'state reference' }, 'Das suas estrelas') : null),
        h('div', { class: 'd' }, c.description || '—'),
        h('div', { class: 'how' }, a.interface ? h('span', { class: 'tagi' }, IFACE[a.interface] || a.interface) : null, (a.domains || []).slice(0, 3).map(d => h('span', { class: 'tagd' }, d)),
          a.emerging ? h('span', { class: 'em' }, 'emergente') : null, h('span', { class: 'muted' }, c.decision === 'filtered' ? `Filtrado: ${c.reason}` : a.how || ''))),
      h('div', { class: 'side' },
        a.score != null && c.decision !== 'filtered' ? h('div', { class: 'score', title: 'Utilidade para agentes (55%), ritmo (20%), manutenção (15%), licença (10%)' }, Math.round(a.score * 100), h('small', null, `${compact(c.stars)} ★ · ${relTime(c.gh_pushed_at)}`)) : h('small', { class: 'muted' }, `${compact(c.stars)} ★`),
        h('div', { class: 'row' },
          btn('', () => api('openExternal', { url: c.url }), { size: 'sm', kind: 'ghost', iconName: 'external', title: 'Abrir no GitHub' }),
          open ? btn('Rejeitar', async () => { await api('reject', { id: c.id, reason: 'não relevante' }); c.decision = 'rejected'; render(); }, { size: 'sm', kind: 'ghost' }) : null,
          open ? btn('Catalogar', async () => { const r = await api('promote', { id: c.id }); c.decision = 'promoted'; toast(`Catalogado: ${r.name}`, 'good'); await runOperation('resource.inspect', { id: r.id }, `Ler o que ${r.name} publica`, { refresh: false }); go(`resource/${encodeURIComponent(r.id)}`); }, { size: 'sm', kind: 'primary', iconName: 'plus' })
            : c.decision === 'filtered' ? btn('Não é ruído', async () => { const r = await api('promote', { id: c.id }); toast(`Catalogado: ${r.name}`, 'good'); c.decision = 'promoted'; render(); }, { size: 'sm' }) : null)));
  };
  const toggle = (label, on, fn) => { const b = h('button', { type: 'button', class: `fchip ${on ? '' : 'off'}`, 'aria-pressed': String(on) }, label); b.addEventListener('click', () => { fn(); persist(); render(); }); return b; };
  const render = () => {
    fill(tabs, [['relevant', 'Relevantes'], ['stars', 'Das suas estrelas'], ['decided', 'Decididos'], ['filtered', 'Filtrado']].map(([id, l]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === id) }, l, h('span', { class: 'n' }, all.filter(c => inTab(c, id)).length));
      b.addEventListener('click', () => { st.tab = id; st.limit = 60; render(); });
      return b;
    }));
    const minIn = h('input', { type: 'range', min: '0', max: '90', step: '5', value: String(st.min), 'aria-label': 'Utilidade mínima' });
    const minLbl = h('span', { class: 'num' }, `≥ ${st.min}`);
    minIn.addEventListener('input', () => { minLbl.textContent = `≥ ${minIn.value}`; });
    minIn.addEventListener('change', () => { st.min = Number(minIn.value); persist(); render(); });
    const sortSel = h('select', { class: 'select', 'aria-label': 'Ordenar' }, SORTS.map(([v, l]) => h('option', { value: v, selected: st.sort === v || null }, l)));
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; persist(); render(); });
    const domSel = h('select', { class: 'select', 'aria-label': 'Domínio' }, h('option', { value: '' }, 'Todos os domínios'), allDomains.map(d => h('option', { value: d, selected: st.domain === d || null }, d)));
    domSel.addEventListener('change', () => { st.domain = domSel.value; persist(); render(); });
    const q = h('input', { type: 'search', placeholder: 'Filtrar resultados…', value: st.q, 'aria-label': 'Filtrar resultados' });
    q.addEventListener('input', () => { st.q = q.value; renderList(); });
    fill(filters,
      h('div', { class: 'dfrow' }, h('div', { class: 'searchbox' }, icon('filter', 'sm'), q), sortSel, domSel,
        h('label', { class: 'range' }, h('span', { class: 'micro' }, 'Utilidade'), minIn, minLbl)),
      h('div', { class: 'dfrow chips' }, Object.entries(IFACE).map(([k, l]) => toggle(l, !st.iface.length || st.iface.includes(k), () => { st.iface = st.iface.includes(k) ? st.iface.filter(x => x !== k) : [...st.iface, k]; if (st.iface.length === Object.keys(IFACE).length) st.iface = []; })),
        h('span', { class: 'sep' }), toggle('Só emergentes', st.emerging, () => { st.emerging = !st.emerging; }), toggle('Esconder o que já está no catálogo', st.hideKnown, () => { st.hideKnown = !st.hideKnown; })));
    renderList();
  };
  const renderList = () => {
    const rows = all.filter(passes).sort(order[st.sort] || order.score);
    fill(listEl, rows.length ? h('div', { class: 'box cands' }, rows.slice(0, st.limit).map(row), rows.length > st.limit ? h('div', { class: 'more-row' }, btn(`Mostrar mais ${Math.min(60, rows.length - st.limit)}`, () => { st.limit += 60; renderList(); }, { kind: 'ghost' })) : null)
      : empty(st.tab === 'stars' ? 'star' : 'radar', st.tab === 'stars' && !all.some(c => c.query_kind === 'stars') ? (connected ? 'Ainda não leu as suas estrelas' : 'Ligue o GitHub para ler as suas estrelas') : 'Nada com estes filtros',
        st.tab === 'stars' ? 'O CURI revê os repositórios a que deu estrela e separa o que é útil aos seus agentes.' : 'Baixe a utilidade mínima, ative mais tipos ou faça uma pesquisa nova.',
        st.tab === 'stars' ? (connected ? btn('Ler as minhas estrelas', () => runOperation('github.stars', {}, 'Ler as estrelas do GitHub', { refresh: false }).then(refresh), { kind: 'primary', iconName: 'star' }) : btn('Ligar o GitHub', () => go('connections'), { kind: 'primary', iconName: 'link' })) : null));
    const selRows = all.filter(c => st.sel.has(c.id));
    fill(bulk, selRows.length ? h('div', { class: 'tray' }, h('span', { class: 'names' }, `${selRows.length} selecionado${selRows.length > 1 ? 's' : ''}`),
      btn('Catalogar todos', async () => { const r = await api('promoteMany', { ids: selRows.map(c => c.id) }); toast(`${r.filter(x => !x.error).length} catalogados`, 'good'); selRows.forEach(c => { c.decision = 'promoted'; }); st.sel.clear(); render(); }, { size: 'sm', kind: 'primary', iconName: 'plus' }),
      btn('Rejeitar', async () => { for (const c of selRows) { await api('reject', { id: c.id, reason: 'não relevante' }); c.decision = 'rejected'; } st.sel.clear(); render(); }, { size: 'sm' }),
      btn('', () => { st.sel.clear(); render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Limpar seleção' })) : null);
  };
  render();
  const last = cands[0]?.scan_started;
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Descobrir'),
      h('p', null, `Projetos do GitHub avaliados pelo que acrescentam a um agente: como ele o alcança e em que área passa a conseguir trabalhar. ${last ? `Última pesquisa ${relTime(last)}.` : ''}`)),
      h('div', { class: 'actions' },
        connected ? btn('Ler as minhas estrelas', () => runOperation('github.stars', {}, 'Ler as estrelas do GitHub', { refresh: false }).then(refresh), { kind: 'ghost', iconName: 'star' }) : null,
        btn('Reconhecimento de fronteira', () => runOperation('discover', { mode: 'frontier', maxQueries: 8 }, 'Reconhecimento de fronteira', { refresh: false }).then(refresh), { kind: 'ghost', iconName: 'compass' }))),
    h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input),
      btn('Guardar', async () => { const q = input.value.trim(); if (q.length < 3) return toast('Escreva primeiro a pesquisa.', 'bad'); saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: q, auto: false })); renderSaved(saved); toast('Pesquisa guardada', 'good'); }, { kind: 'ghost', iconName: 'star', title: 'Guardar esta pesquisa' }),
      btn('Procurar', () => runSearch(), { kind: 'primary', iconName: 'radar' })),
    savedBox,
    !connected ? notice('info', 'Sem GitHub ligado as pesquisas usam o limite anónimo (10 por minuto). Em Ligações pode reutilizar a sessão do GitHub CLI ou guardar um token no cofre do sistema.') : null,
    h('div', { class: 'sec' }, tabs), filters, listEl, bulk);
}
