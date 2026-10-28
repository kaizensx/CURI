// Discover: GitHub projects judged by what they would let an agent do, and shown only when CURI has
// inspected them and can actually install or connect them here. One click installs; nothing is
// catalogued and left without a next step.
import { h, fill, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, toast, notice } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runOperation } from './control.js';
import { runAction, kindTile } from './common.js';

const IFACE = { mcp: 'MCP server', plugin: 'Plugin', skill: 'Skill', 'computer-use': 'Browser/screen control', cli: 'Command line', 'scriptable-app': 'Scriptable app', api: 'API/SDK', library: 'Library', ui: 'UI components' };
const SORTS = [['score', 'Most useful to agents'], ['stars', 'Most stars'], ['recent', 'Recently active'], ['new', 'Newest']];
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Install a discovery in one go: catalogue it with its inspected facts, then run the best install option
// (installing a missing prerequisite first when that is all that stands in the way).
async function install(c, after) {
  const r = await api('candidateAdopt', { id: c.id });
  const pick = v => v.actions.primary || v.actions.install.find(x => !x.disabled && !x.shared);
  let v = await api('resourceView', { id: r.id });
  let a = pick(v);
  if (!a) {
    const pre = v.actions.install.find(x => x.prereq);
    if (!pre) { go(`resource/${encodeURIComponent(r.id)}`); return; }
    await runAction(pre.prereq, pre.missing.join(', '));
    v = await api('resourceView', { id: r.id });
    a = pick(v);
    if (!a) { go(`resource/${encodeURIComponent(r.id)}`); return; }
  }
  await runAction(a, r.name, after);
}

export async function discoverView() {
  const p = params();
  const [cands, gh, saved] = await Promise.all([api('candidatesAll', { limit: 1500 }), api('connections').then(l => l.find(x => x.provider === 'github')).catch(() => null), api('savedSearches')]);
  const seen = new Map();
  for (const c of cands) if (!seen.has(c.full_name)) seen.set(c.full_name, c);
  const all = [...seen.values()];
  const prefs = lsGet('curi-discover', { sort: 'score', iface: [], domain: '', emerging: false });
  const st = { tab: p.get('tab') || 'ready', q: '', limit: 40, ...prefs };
  const persist = () => lsSet('curi-discover', { sort: st.sort, iface: st.iface, domain: st.domain, emerging: st.emerging });
  const connected = gh?.status === 'connected';
  const refresh = () => location.reload();
  const sc = c => c.score?.agent?.score ?? 0;

  // Installable = inspected, and at least one install option works on this system.
  const open = c => c.decision === 'candidate' && !c.in_registry;
  const installable = all.filter(c => open(c) && c.install?.installable);
  const pending = all.filter(c => open(c) && !c.install);
  const fromStars = installable.filter(c => c.query_kind === 'stars');
  const done = all.filter(c => c.decision === 'promoted' || c.in_registry);
  const lists = { ready: installable, stars: fromStars, done };

  const passes = c => (!st.iface.length || st.iface.includes(c.score?.agent?.interface)) && (!st.domain || (c.score?.agent?.domains || []).includes(st.domain)) && (!st.emerging || c.score?.agent?.emerging)
    && (!st.q || `${c.full_name} ${c.description || ''}`.toLowerCase().includes(st.q.toLowerCase()));
  const order = { score: (a, b) => sc(b) - sc(a), stars: (a, b) => (b.stars || 0) - (a.stars || 0), recent: (a, b) => (b.gh_pushed_at || '').localeCompare(a.gh_pushed_at || ''), new: (a, b) => (b.gh_created_at || '').localeCompare(a.gh_created_at || '') };

  const input = h('input', { type: 'search', id: 'page-search', value: p.get('intent') || '', placeholder: 'What should an agent be able to do? e.g. "edit CAD files", "transcribe meetings"', 'aria-label': 'Need to search for on GitHub' });
  const runSearch = (q = input.value.trim()) => { if (q.length < 3) { toast('Describe the need in a few words.', 'bad'); return null; } return runOperation('discover', { mode: 'task', intent: q }, `Search GitHub: ${q}`, { refresh: false }).then(refresh); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

  const savedBox = h('div', { class: 'saved' });
  const renderSaved = list => fill(savedBox, list.map(s => h('span', { class: 'saved-chip' },
    h('button', { type: 'button', class: 'go', title: 'Search again' }, icon('radar', 'sm'), s.intent),
    h('button', { type: 'button', class: `auto ${s.auto ? 'on' : ''}`, title: s.auto ? 'Runs on its own during maintenance (click to stop)' : 'Run on its own during maintenance' }, icon('clock', 'sm')),
    h('button', { type: 'button', class: 'rm', title: 'Forget' }, icon('x', 'sm')))));
  savedBox.addEventListener('click', async e => {
    const chip = e.target.closest('.saved-chip'); if (!chip) return;
    const s = saved[[...savedBox.children].indexOf(chip)];
    if (e.target.closest('.go')) return runSearch(s.intent);
    if (e.target.closest('.auto')) { saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: s.intent, auto: !s.auto })); toast(s.auto ? 'No longer runs on its own' : 'Will run on its own during maintenance', 'good'); }
    if (e.target.closest('.rm')) saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: s.intent, remove: true }));
    renderSaved(saved);
  });
  renderSaved(saved);

  const filters = h('div', { class: 'dfilters' });
  const listEl = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Source' });
  const allDomains = [...new Set(installable.flatMap(c => c.score?.agent?.domains || []))].sort();

  const card = c => {
    const a = c.score?.agent || {}, ins = c.install || {};
    const [owner, name] = c.full_name.split('/');
    const isOpen = open(c);
    const opt = (ins.options || [])[0];
    return h('article', { class: 'dcard' },
      h('div', { class: 'dc-top' }, kindTile(ins.kind || 'cli'),
        h('div', { class: 'grow' }, h('div', { class: 'nm' }, h('strong', null, name), h('span', { class: 'own' }, owner)), h('span', { class: 'k' }, ins.kind_label || IFACE[a.interface] || '')),
        a.score != null ? h('div', { class: 'score', title: 'Usefulness to agents (55%), momentum (20%), upkeep (15%), licence (10%)' }, Math.round(a.score * 100)) : null),
      h('p', { class: 'd' }, c.description || '—'),
      h('div', { class: 'how' }, (a.domains || []).slice(0, 2).map(d => h('span', { class: 'tagd' }, d)), a.emerging ? h('span', { class: 'em' }, 'emerging') : null, c.query_kind === 'stars' ? h('span', { class: 'tagd' }, 'starred by you') : null),
      h('div', { class: 'dc-foot' },
        h('span', { class: 'meta' }, icon('star', 'sm'), compact(c.stars), ' · ', relTime(c.gh_pushed_at)),
        opt ? h('span', { class: 'via', title: (ins.options || []).map(o => o.label).join(' · ') }, opt.label, opt.ready ? null : ` (needs ${opt.missing.join(', ')})`) : null,
        h('span', { class: 'grow' }),
        btn('', () => api('openExternal', { url: c.url }), { size: 'sm', kind: 'ghost', iconName: 'external', title: 'Open on GitHub' }),
        isOpen ? btn('', async () => { await api('reject', { id: c.id, reason: 'not relevant' }); c.decision = 'rejected'; render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Not interested' }) : null,
        isOpen ? btn('Install', () => install(c, refresh), { size: 'sm', kind: 'primary', iconName: 'download' })
          : btn('Open', () => api('library').then(l => { const r = l.find(x => x.gh_full_name?.toLowerCase() === c.full_name); go(r ? `resource/${encodeURIComponent(r.id)}` : 'library'); }), { size: 'sm' })));
  };
  const toggle = (label, on, fn) => { const b = h('button', { type: 'button', class: `fchip ${on ? '' : 'off'}`, 'aria-pressed': String(on) }, label); b.addEventListener('click', () => { fn(); persist(); render(); }); return b; };
  const render = () => {
    fill(tabs, [['ready', 'Ready to install', installable.length], ['stars', 'From your stars', fromStars.length], ['done', 'Added', done.length]].map(([id, l, n]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === id) }, l, h('span', { class: 'n' }, n));
      b.addEventListener('click', () => { st.tab = id; st.limit = 40; render(); });
      return b;
    }));
    const sortSel = h('select', { class: 'select', 'aria-label': 'Sort' }, SORTS.map(([v, l]) => h('option', { value: v, selected: st.sort === v || null }, l)));
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; persist(); render(); });
    const domSel = h('select', { class: 'select', 'aria-label': 'Domain' }, h('option', { value: '' }, 'All domains'), allDomains.map(d => h('option', { value: d, selected: st.domain === d || null }, d)));
    domSel.addEventListener('change', () => { st.domain = domSel.value; persist(); render(); });
    const q = h('input', { type: 'search', placeholder: 'Filter results…', value: st.q, 'aria-label': 'Filter results' });
    q.addEventListener('input', () => { st.q = q.value; renderList(); });
    fill(filters,
      h('div', { class: 'dfrow' }, h('div', { class: 'searchbox' }, icon('filter', 'sm'), q), sortSel, domSel, toggle('Emerging only', st.emerging, () => { st.emerging = !st.emerging; })),
      h('div', { class: 'dfrow chips' }, Object.entries(IFACE).map(([k, l]) => toggle(l, !st.iface.length || st.iface.includes(k), () => { st.iface = st.iface.includes(k) ? st.iface.filter(x => x !== k) : [...st.iface, k]; if (st.iface.length === Object.keys(IFACE).length) st.iface = []; }))));
    renderList();
  };
  const renderList = () => {
    const rows = (lists[st.tab] || installable).filter(passes).sort(order[st.sort] || order.score);
    fill(listEl, rows.length ? [h('div', { class: 'dgrid' }, rows.slice(0, st.limit).map(card)), rows.length > st.limit ? h('div', { class: 'more-row' }, btn(`Show ${Math.min(40, rows.length - st.limit)} more`, () => { st.limit += 40; renderList(); }, { kind: 'ghost' })) : null]
      : empty(st.tab === 'stars' ? 'star' : 'radar', st.tab === 'stars' ? (connected ? 'Nothing installable from your stars yet' : 'Connect GitHub to read your stars') : 'Nothing ready to install yet',
        st.tab === 'stars' ? 'CURI reviews the repositories you starred and keeps only what it can install for your agents.' : 'Search for a need, or run a frontier sweep. CURI inspects what it finds and only shows what it can install here.',
        st.tab === 'stars' ? (connected ? btn('Read my stars', () => runOperation('github.stars', {}, 'Read GitHub stars', { refresh: false }).then(refresh), { kind: 'primary', iconName: 'star' }) : btn('Connect GitHub', () => go('connections'), { kind: 'primary', iconName: 'link' })) : null));
  };
  render();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Discover'),
      h('p', null, 'New GitHub projects that give your agents something they can\'t do yet. CURI inspects each one and only shows what it can install here, in one click.')),
      h('div', { class: 'actions' },
        connected ? btn('Read my stars', () => runOperation('github.stars', {}, 'Read GitHub stars', { refresh: false }).then(refresh), { kind: 'ghost', iconName: 'star' }) : null,
        btn('Frontier sweep', () => runOperation('discover', { mode: 'frontier', maxQueries: 8 }, 'Frontier sweep', { refresh: false }).then(refresh), { kind: 'ghost', iconName: 'compass' }))),
    h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input),
      btn('Save', async () => { const q = input.value.trim(); if (q.length < 3) return toast('Type the search first.', 'bad'); saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: q, auto: false })); renderSaved(saved); toast('Search saved', 'good'); }, { kind: 'ghost', iconName: 'star', title: 'Save this search' }),
      btn('Search', () => runSearch(), { kind: 'primary', iconName: 'radar' })),
    savedBox,
    !connected ? notice('info', 'Without GitHub connected, searches use the anonymous limit (10 a minute). In Connections you can reuse the GitHub CLI session or store a token in the system vault.') : null,
    pending.length ? h('div', { class: 'pending-note' }, icon('clock', 'sm'), h('span', null, `${pending.length} more discover${pending.length === 1 ? 'y hasn\'t' : 'ies haven\'t'} been inspected yet.`), btn('Inspect the next 20', () => runOperation('discover.inspect', { limit: 20 }, 'Inspect discoveries', { refresh: false }).then(refresh), { size: 'sm', kind: 'ghost' })) : null,
    h('div', { class: 'sec' }, tabs), filters, listEl);
}
