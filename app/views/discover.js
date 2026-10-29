// Discover: GitHub projects judged by what they would let an agent do, and shown only when CURI has
// inspected them and can actually install or connect them here. One click installs; nothing is
// catalogued and left without a next step.
import { h, fill, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, toast, notice, pager } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runOperation } from './control.js';
import { runAction } from './common.js';
import { hero, searchCapsule, art } from './hero.js';

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

export async function discoverView(tabsNav) {
  const p = params();
  const [cands, gh, saved] = await Promise.all([api('candidatesAll', { limit: 1500 }), api('connections').then(l => l.find(x => x.provider === 'github')), api('savedSearches')]);
  const seen = new Map();
  for (const c of cands) if (!seen.has(c.full_name)) seen.set(c.full_name, c);
  const all = [...seen.values()];
  const prefs = lsGet('curi-discover', { sort: 'score', iface: [], domain: '', emerging: false });
  const st = { tab: p.get('tab') || 'ready', q: '', page: 0, ...prefs };
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

  const input = h('input', { type: 'search', id: 'page-search', value: p.get('intent') || '', maxlength: '500', placeholder: 'What should an agent be able to do? e.g. "edit CAD files", "transcribe meetings"', 'aria-label': 'Need to search for on GitHub' });
  const runSearch = (q = input.value.trim()) => { if (q.length < 3) { toast('Describe the need in a few words.', 'bad'); return null; } return runOperation('discover', { mode: 'task', intent: q }, `Search GitHub: ${q}`, { refresh: false }).then(refresh); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch()?.catch(err => toast(err.message, 'bad')); });

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
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Source' });
  const allDomains = [...new Set(installable.flatMap(c => c.score?.agent?.domains || []))].sort();

  const card = c => {
    const a = c.score?.agent || {}, ins = c.install || {};
    const [owner, name] = c.full_name.split('/');
    const isOpen = open(c);
    const action = c.presence ? btn('Open', () => go(`resource/${encodeURIComponent(c.resource_id)}`), { size: 'sm', kind: 'pill' })
      : isOpen || (c.resource_id && ins.installable) ? btn('Install', () => install(c, refresh), { size: 'sm', kind: 'pill get', iconName: 'download' })
      : btn('Open', () => go(c.resource_id ? `resource/${encodeURIComponent(c.resource_id)}` : `project/${c.id}`), { size: 'sm', kind: 'pill' });
    const el = h('article', { class: 'gcard dcard2', tabindex: '0', role: 'listitem', 'aria-label': `${name} by ${owner}` },
      h('div', { class: 'g-top' }, art(c.full_name, ins.kind || 'cli'),
        h('div', { class: 'g-id' }, h('strong', null, name), h('span', null, ins.kind_label || IFACE[a.interface] || '', h('i', null, ` · ${owner}`))),
        a.score != null ? h('span', { class: 'g-score', title: 'Usefulness to agents (55%), momentum (20%), upkeep (15%), licence (10%)' }, Math.round(a.score * 100)) : null),
      h('p', null, c.description || ''),
      h('div', { class: 'g-tags' }, (a.domains || []).slice(0, 2).map(d => h('span', null, d)), a.emerging ? h('span', { class: 'em' }, 'emerging') : null, c.query_kind === 'stars' ? h('span', null, 'starred by you') : null),
      h('div', { class: 'g-foot' },
        h('div', { class: 'g-meta' }, h('span', null, icon('star', 'sm'), compact(c.stars)), h('span', null, relTime(c.gh_pushed_at))),
        isOpen && !c.presence ? btn('', async () => { await api('reject', { id: c.id, reason: 'not relevant' }); c.decision = 'rejected'; render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Not interested' }) : null,
        c.presence ? h('span', { class: 'state installed', title: c.presence.where.join(', ') }, 'Installed') : null,
        action));
    // The card opens the project's page: what it is, what it would add, how CURI would install it.
    const openPage = () => go(c.resource_id ? `resource/${encodeURIComponent(c.resource_id)}` : `project/${c.id}`);
    el.addEventListener('click', e => { if (!e.target.closest('button, a')) openPage(); });
    el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPage(); } });
    return el;
  };
  const toggle = (label, on, fn) => { const b = h('button', { type: 'button', class: `fchip ${on ? '' : 'off'}`, 'aria-pressed': String(on) }, label); b.addEventListener('click', () => { fn(); persist(); render(); }); return b; };
  const render = () => {
    fill(tabs, [['ready', 'Ready to install', installable.length], ['stars', 'From your stars', fromStars.length], ['done', 'In your library', done.length]].map(([id, l, n]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(st.tab === id) }, l, h('span', { class: 'n' }, n));
      b.addEventListener('click', () => { st.tab = id; st.page = 0; render(); });
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
    if (st.page * 24 >= rows.length) st.page = 0;
    fill(listEl, rows.length ? [h('div', { class: 'cat-grid', role: 'list' }, rows.slice(st.page * 24, (st.page + 1) * 24).map(card)), pager(rows.length, st.page, 24, n => { st.page = n; renderList(); listEl.scrollIntoView({ block: 'start' }); }, { noun: 'projects' })]
      : empty(st.tab === 'stars' ? 'star' : 'radar', st.tab === 'stars' ? (connected ? 'Nothing installable from your stars yet' : 'Connect GitHub to read your stars') : 'Nothing ready to install yet',
        st.tab === 'stars' ? 'CURI reviews the repositories you starred and keeps only what it can install for your agents.' : 'Search for a need, or run a frontier sweep. CURI inspects what it finds and only shows what it can install here.',
        st.tab === 'stars' ? (connected ? btn('Read my stars', () => runOperation('github.stars', {}, 'Read GitHub stars', { refresh: false }).then(refresh), { kind: 'primary', iconName: 'star' }) : btn('Connect GitHub', () => go('connections'), { kind: 'primary', iconName: 'link' })) : null));
  };
  render();
  const saveBtn = btn('Save', async () => { const q = input.value.trim(); if (q.length < 3) return toast('Type the search first.', 'bad'); saved.splice(0, saved.length, ...await api('savedSearchSet', { intent: q, auto: false })); renderSaved(saved); toast('Search saved', 'good'); }, { kind: 'ghost', size: 'sm', iconName: 'star', title: 'Save this search' });
  const searchBtn = btn('Search GitHub', () => runSearch(), { kind: 'primary', size: 'sm', iconName: 'radar' });
  return h('div', { class: 'page cat' },
    hero({ eyebrow: 'Library', title: 'New abilities, ', em: 'found on GitHub.',
      sub: `${installable.length} projects CURI inspected and can install here, from its weekly look at GitHub${connected ? ' and your stars' : ''}. Search for anything an agent should be able to do.`,
      actions: [
        connected ? btn('Read my stars', () => runOperation('github.stars', {}, 'Read GitHub stars', { refresh: false }).then(refresh), { kind: 'ghost', size: 'sm', iconName: 'star' }) : null,
        btn('Look now', () => runOperation('discover', { mode: 'frontier', maxQueries: 8 }, 'Look for new projects on GitHub', { refresh: false }).then(refresh), { kind: 'ghost', size: 'sm', iconName: 'compass' }),
        tabsNav],
      search: searchCapsule(input, saveBtn, searchBtn), after: savedBox }),
    !connected ? notice('info', 'Without GitHub connected, searches use the anonymous limit (10 a minute). In Connections you can reuse the GitHub CLI session or store a token in the system vault.') : null,
    pending.length ? h('div', { class: 'pending-note' }, icon('clock', 'sm'), h('span', null, `${pending.length} more discover${pending.length === 1 ? 'y hasn\'t' : 'ies haven\'t'} been inspected yet.`), btn('Inspect the next 20', () => runOperation('discover.inspect', { limit: 20 }, 'Inspect discoveries', { refresh: false }).then(refresh), { size: 'sm' })) : null,
    h('div', { class: 'cat-bar' }, h('div', { class: 'cat-bar-in' }, tabs, filters)), listEl);
}

// A project found on GitHub that isn't in the library yet: what it is, why CURI thinks an agent would
// use it, and how it would be installed here. Installing catalogues it and opens its resource page.
export async function projectView(id) {
  const c = (await api('candidatesAll', { limit: 2000 })).find(x => String(x.id) === String(id));
  if (!c) return h('div', { class: 'page' }, empty('alert', 'Project not found', 'It may have been cleared from the list of discoveries.', btn('Back to New on GitHub', () => go('library?tab=new'), { kind: 'primary' })));
  if (c.resource_id) { location.replace(`#/resource/${encodeURIComponent(c.resource_id)}`); return h('div'); }
  const a = c.score?.agent || {}, ins = c.install || {};
  const [owner, name] = c.full_name.split('/');
  const url = `https://github.com/${c.full_name}`;
  const after = () => go('library?tab=new');
  const sub = [ins.kind_label || IFACE[a.interface], owner, c.license && c.license !== 'none' ? c.license : null].filter(Boolean);
  const head = h('header', { class: 'sheet-head' }, art(c.full_name, ins.kind || 'cli', 'lg'),
    h('div', null, h('h1', null, name), h('div', { class: 'sub' }, sub.map(s => h('span', null, s)), a.emerging ? h('span', { class: 'state new' }, 'Emerging') : null)),
    a.score != null ? h('div', { class: 'p-score', title: 'Usefulness to agents (55%), momentum (20%), upkeep (15%), licence (10%)' }, h('strong', null, Math.round(a.score * 100)), h('span', null, 'agent score')) : null);
  const bar = h('div', { class: 'actionbar' },
    ins.installable ? btn('Install', () => install(c, after), { kind: 'primary', iconName: 'download' }) : h('span', { class: 'lead' }, ins.installable === false ? 'CURI found no way to install this here yet.' : 'Not inspected yet.'),
    c.decision === 'candidate' ? btn('Not interested', async () => { await api('reject', { id: c.id, reason: 'not relevant' }); toast('Hidden from New on GitHub'); after(); }, { kind: 'ghost', iconName: 'x' }) : null,
    h('span', { class: 'grow' }),
    h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener' }, icon('external', 'sm'), 'GitHub'));
  const options = ins.options?.length ? h('div', { class: 'box' }, ins.options.map(o => h('div', { class: 'opt' },
    h('div', null, h('div', { class: 't' }, o.label), h('div', { class: 's' }, o.ready ? 'Ready on this computer' : o.missing?.length ? `needs ${o.missing.join(', ')} (CURI installs it first)` : '')),
    o.ready ? h('span', { class: 'state installed' }, 'Ready') : null))) : null;
  const dl = [];
  const fact = (k, v) => { if (v != null && v !== '') dl.push(h('dt', null, k), h('dd', null, v)); };
  fact('Stars', c.stars != null ? compact(c.stars) : null);
  fact('Last change', c.gh_pushed_at ? relTime(c.gh_pushed_at) : null);
  fact('Created', c.gh_created_at ? relTime(c.gh_created_at) : null);
  fact('Licence', c.license && c.license !== 'none' ? c.license : 'None stated');
  fact('Found by', c.query_kind === 'stars' ? 'Your GitHub stars' : c.mode === 'task' ? 'A search' : 'The weekly look at GitHub');
  const sec = (title, meta, node) => (node ? [h('div', { class: 'sec' }, h('h2', null, title), meta ? h('span', { class: 'meta' }, meta) : null), node] : []);
  return h('div', { class: 'page' }, head, bar,
    h('div', { class: 'sheet' },
      h('div', null,
        ...sec('What it is', null, h('div', { class: 'stack' }, h('p', { class: 'prose' }, c.description || 'No description.'), ins.how || a.how ? h('p', { class: 'prose dim' }, ins.how || a.how) : null)),
        ...sec('Why it showed up', null, a.why?.length ? h('ul', { class: 'why-list' }, a.why.map(w => h('li', null, icon('check', 'sm'), w))) : null),
        ...sec('How CURI would install it', 'each option runs visibly, with progress and verification', options)),
      h('div', null,
        ...sec('Facts', null, h('div', { class: 'box pad' }, h('dl', { class: 'facts' }, dl))),
        ...sec('Areas', null, a.domains?.length ? h('div', { class: 'capchips' }, a.domains.map(d => h('span', { class: 'capchip' }, d))) : null),
        ...sec('Topics', null, c.topics?.length ? h('div', { class: 'capchips' }, c.topics.slice(0, 12).map(t => h('span', { class: 'capchip' }, t))) : null))));
}
