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
const KIND_PLURAL = { plugin: 'Claude Code plugins', 'skill-pack': 'Skill packs', skill: 'Skills', mcp: 'MCP servers', cli: 'Command-line tools', app: 'Apps', components: 'UI components', library: 'Libraries', framework: 'Frameworks', reference: 'References' };

export function resourceMenu(r) {
  return [
    { label: 'Open details', icon: 'chevron', run: () => go(`resource/${encodeURIComponent(r.id)}`) },
    { label: 'Open source in browser', icon: 'external', run: () => api('openExternal', { url: r.canonical_url }) },
    { label: 'Copy URL', icon: 'copy', run: async () => { await navigator.clipboard.writeText(r.canonical_url); toast('URL copiado'); } },
    '-',
    { label: compareTray.has(r.id) ? 'Remove from comparison' : 'Add to comparison', icon: 'compare', run: () => compareTray.toggle(r.id) },
    { label: 'Refresh project data', icon: 'refresh', run: () => runOperation('resource.inspect', { id: r.id }, `Refresh data: ${r.name}`) },
  ];
}

function railItem(label, n, pressed, onclick, swatch) {
  const b = h('button', { type: 'button', class: 'rail-item', 'aria-pressed': String(pressed) }, swatch ? h('span', { class: 'sw', style: { background: swatch } }) : null, h('span', null, label), h('span', { class: 'n' }, n));
  b.addEventListener('click', onclick);
  return b;
}

const SORTS = [['smart', 'Relevance'], ['name', 'Name'], ['stars', 'Most stars'], ['updated', 'Recently active'], ['state', 'Status']];
const VIEWS = [['all', 'All'], ['here', 'On this device'], ['ready', 'Ready to install'], ['project', 'For projects'], ['fav', 'Favourites'], ['hidden', 'Hidden']];
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const DAY = 864e5;

// The one useful thing to do from a row, for every kind of resource.
async function quickAction(r, after) {
  if (!r.state && r.installable && r.kind !== 'reference') {
    const pick = v => v.actions.primary || v.actions.install.find(x => !x.disabled && !x.shared);
    let v = await api('resourceView', { id: r.id });
    let a = pick(v);
    // Only a missing prerequisite stands in the way: install it first, then the resource.
    if (!a) { const pre = v.actions.install.find(x => x.prereq); if (pre) { await runAction(pre.prereq, pre.missing.join(', ')); v = await api('resourceView', { id: r.id }); a = pick(v); } }
    if (a) return runAction(a, r.name, after);
  }
  if (r.has_project) {
    const v = await api('resourceView', { id: r.id });
    if (v.actions.project.length) return addToProject(r.name, v.actions.project).then(after);
  }
  return go(`resource/${encodeURIComponent(r.id)}`);
}
const quickLabel = r => (!r.state && r.installable && r.kind !== 'reference' ? [r.kind === 'components' ? 'Give to agent' : 'Get', 'download', 'primary']
  : r.has_project && !r.state ? ['Add to project', 'plus', ''] : ['Manage', 'settings', 'ghost']);

export async function library() {
  const p = params();
  const [everything, capMap, cols] = await Promise.all([api('library'), api('capabilityMap'), api('collections')]);
  // Only what CURI can act on: install, connect, add to a project, or manage what's already here.
  const actionable = r => Boolean(r.state || r.installable || r.has_project);
  const all = everything.filter(actionable);
  const st = { view: p.get('view') || 'all', kind: p.get('kind') || '', domain: p.get('domain') || '', col: p.get('col') || '', origin: '', upkeep: '', q: p.get('q') || '', sort: lsGet('curi-lib-sort', 'smart'), layout: lsGet('curi-lib-layout', 'list'), limit: 60, sel: new Set() };
  const capDomain = new Map(capMap.capabilities.map(c => [c.id, c.domain]));
  const prep = list => { for (const r of list) r.domains = [...new Set(r.capabilities.map(c => capDomain.get(c)).filter(Boolean))]; };
  prep(all);
  const inView = (r, v = st.view) => (v === 'hidden' ? r.mine.hidden : !r.mine.hidden && (v === 'all' || (v === 'here' && ['installed', 'configured', 'account'].includes(r.state)) || (v === 'ready' && !r.state && r.ready) || (v === 'project' && ['library', 'framework', 'components'].includes(r.kind)) || (v === 'reference' && r.kind === 'reference') || (v === 'fav' && r.mine.fav)));
  const passes = r => inView(r) && (!st.kind || r.kind === st.kind) && (!st.domain || r.domains.includes(st.domain)) && (!st.col || (r.mine.collections || []).includes(st.col))
    && (!st.origin || (st.origin === 'github' ? r.gh_full_name : !r.gh_full_name))
    && (!st.upkeep || (st.upkeep === 'active' ? r.pushed_at && Date.now() - new Date(r.pushed_at) < 90 * DAY : r.pushed_at && Date.now() - new Date(r.pushed_at) > 365 * DAY));
  let ranked = null;
  const rail = h('aside', { class: 'rail', 'aria-label': 'Filters' });
  const list = h('div', { 'aria-live': 'polite' });
  const count = h('span', { class: 'lib-count' });
  const chipsRow = h('div', { class: 'active-filters' });
  const bulk = h('div');
  const input = h('input', { type: 'search', id: 'page-search', value: st.q, placeholder: 'Describe what you want the agent to do: "control Blender", "test my site", "GSAP alternative"', 'aria-label': 'Search the library' });
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort' }, SORTS.map(([v, l]) => h('option', { value: v, selected: st.sort === v || null }, l)));
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; lsSet('curi-lib-sort', st.sort); render(); });
  const layoutBtns = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'View' });

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
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Show'), VIEWS.map(([v, l]) => { const c = all.filter(r => inView(r, v)).length; return v === 'hidden' && !c ? null : railItem(l, c, st.view === v, () => { st.view = v; st.limit = 60; render(); }); })),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro rail-head' }, 'Collections', btn('', async () => { const name = await promptDialog({ title: 'New collection', placeholder: 'e.g. Client project, To try', confirm: 'Create' }); if (name?.trim()) { await api('collectionAdd', { name }); cols.push({ name: name.trim() }); render(); } }, { size: 'sm', kind: 'ghost', iconName: 'plus', title: 'New collection' })),
        myCols.length ? myCols.map(c => railItem(c, all.filter(r => (r.mine.collections || []).includes(c)).length, st.col === c, () => set('col', c))) : h('p', { class: 'rail-empty' }, 'Group resources into your own collections: select them and choose "Collection".')),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Kind'), KIND_ORDER.filter(k => k !== 'reference').map(k => [k, n(r => r.kind === k)]).filter(([, c]) => c).map(([k, c]) => railItem(KIND_PLURAL[k], c, st.kind === k, () => set('kind', k)))),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Area'), capMap.domains.map(d => [d, n(r => r.domains.includes(d.id))]).filter(([, c]) => c).sort((a, b) => b[1] - a[1]).map(([d, c]) => railItem(d.label, c, st.domain === d.id, () => set('domain', d.id)))),
      h('div', { class: 'rail-group' }, h('span', { class: 'micro' }, 'Source and upkeep'),
        railItem('GitHub', n(r => r.gh_full_name), st.origin === 'github', () => set('origin', 'github')), railItem('Websites', n(r => !r.gh_full_name), st.origin === 'web', () => set('origin', 'web')),
        railItem('Active (90 days)', n(r => r.pushed_at && Date.now() - new Date(r.pushed_at) < 90 * DAY), st.upkeep === 'active', () => set('upkeep', 'active')),
        railItem('Inactive for over a year', n(r => r.pushed_at && Date.now() - new Date(r.pushed_at) > 365 * DAY), st.upkeep === 'stale', () => set('upkeep', 'stale'))));
  };
  const reload = async () => { const fresh = (await api('library')).filter(actionable); prep(fresh); all.splice(0, all.length, ...fresh); render(); };
  const toggleFav = async r => { r.mine = await api('mark', { id: r.id, patch: { fav: !r.mine.fav } }); render(); };

  const item = r => {
    const [ql, qi, qk] = quickLabel(r);
    const pick = h('button', { type: 'button', class: 'pick', 'aria-pressed': String(st.sel.has(r.id)), 'aria-label': `Select ${r.name}` }, icon('check'));
    pick.addEventListener('click', e => { e.stopPropagation(); st.sel.has(r.id) ? st.sel.delete(r.id) : st.sel.add(r.id); render(); });
    const star = h('button', { type: 'button', class: `fav ${r.mine.fav ? 'on' : ''}`, 'aria-pressed': String(Boolean(r.mine.fav)), 'aria-label': r.mine.fav ? 'Remove from favourites' : 'Favourite', title: 'Favourite' }, icon('star', 'sm'));
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
    el.addEventListener('contextmenu', e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [...resourceMenu(r), '-', { label: r.mine.fav ? 'Remove from favourites' : 'Favourite', icon: 'star', run: () => toggleFav(r) }, { label: r.mine.hidden ? 'Show' : 'Hide', icon: 'x', run: async () => { r.mine = await api('mark', { id: r.id, patch: { hidden: !r.mine.hidden } }); render(); } }]); });
    return el;
  };

  const renderBulk = () => {
    const ids = [...st.sel];
    const rows = all.filter(r => st.sel.has(r.id));
    const ready = rows.filter(r => !r.state && r.ready && r.kind !== 'reference');
    fill(bulk, ids.length ? h('div', { class: 'tray', role: 'region', 'aria-label': 'Selection' },
      h('span', { class: 'names' }, `${ids.length} selecionado${ids.length > 1 ? 's' : ''}`),
      btn('Compare', () => { compareTray.clear(); ids.slice(0, 5).forEach(id => compareTray.add(id)); go('compare'); }, { size: 'sm', iconName: 'compare', disabled: ids.length < 2 }),
      btn('Collection', async () => { const name = await promptDialog({ title: `Add ${ids.length} to a collection`, body: cols.length ? `Existing: ${cols.map(c => c.name).join(', ')}` : null, placeholder: 'collection name', confirm: 'Add' }); if (!name?.trim()) return; for (const r of rows) r.mine = await api('mark', { id: r.id, patch: { collections: [...(r.mine.collections || []), name.trim()] } }); if (!cols.some(c => c.name === name.trim())) cols.push({ name: name.trim() }); toast(`${rows.length} in "${name.trim()}"`, 'good'); render(); }, { size: 'sm', iconName: 'layers' }),
      btn('Favourites', async () => { for (const r of rows) r.mine = await api('mark', { id: r.id, patch: { fav: true } }); render(); }, { size: 'sm', iconName: 'star' }),
      ready.length ? btn(`Install ${ready.length}`, async () => { for (const r of ready) await quickAction(r, () => {}); st.sel.clear(); reload(); }, { size: 'sm', kind: 'primary', iconName: 'download' }) : null,
      btn('', () => { st.sel.clear(); render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Clear selection' })) : null);
  };
  const renderChips = () => {
    const act = [];
    if (st.view !== 'all') act.push([VIEWS.find(v => v[0] === st.view)[1], () => { st.view = 'all'; }]);
    if (st.kind) act.push([KIND_PLURAL[st.kind], () => { st.kind = ''; }]);
    if (st.domain) act.push([capMap.domains.find(d => d.id === st.domain)?.label, () => { st.domain = ''; }]);
    if (st.col) act.push([`Collection: ${st.col}`, () => { st.col = ''; }]);
    if (st.origin) act.push([st.origin === 'github' ? 'GitHub' : 'Websites', () => { st.origin = ''; }]);
    if (st.upkeep) act.push([st.upkeep === 'active' ? 'Active' : 'Inactive', () => { st.upkeep = ''; }]);
    fill(chipsRow, act.length ? [...act.map(([l, clear]) => { const b = h('button', { type: 'button', class: 'fchip' }, l, icon('x', 'sm')); b.addEventListener('click', () => { clear(); render(); }); return b; }),
      btn('Clear filters', () => { Object.assign(st, { view: 'all', kind: '', domain: '', col: '', origin: '', upkeep: '' }); render(); }, { size: 'sm', kind: 'ghost' })] : null);
  };
  const render = () => {
    renderRail(); renderChips(); renderBulk();
    fill(layoutBtns, [['list', 'list', 'List'], ['grid', 'grid', 'Grid']].map(([v, ic, l]) => { const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.layout === v), title: l }, icon(ic, 'sm')); b.addEventListener('click', () => { st.layout = v; lsSet('curi-lib-layout', v); render(); }); return b; }));
    const rows = filtered();
    count.textContent = `${rows.length} resource${rows.length === 1 ? '' : 's'}`;
    fill(list, rows.length ? h('div', { class: st.layout === 'grid' ? 'rgrid' : 'rlist', role: 'list' }, rows.slice(0, st.limit).map(item))
      : empty('search', 'Nothing matches these filters', ranked ? 'No catalogue resource matches. Discover searches GitHub.' : 'Try another area or kind.', ranked ? btn('Search GitHub', () => go(`discover?intent=${encodeURIComponent(st.q)}`), { iconName: 'radar' }) : null),
      rows.length > st.limit ? h('div', { class: 'more-row' }, btn(`Show ${Math.min(60, rows.length - st.limit)} more`, () => { st.limit += 60; render(); }, { kind: 'ghost' })) : null);
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
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Library'), h('p', null, `${all.length} resources CURI can act on: ${here} are already here or in your account, ${ready} install in one click, and the rest go into your projects.`)),
      h('div', { class: 'actions' }, btn('Add URL', () => window.__curiMenu('add-url-dialog'), { kind: 'ghost', iconName: 'plus' }))),
    h('div', { class: 'lib' }, rail, h('div', null,
      h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input), sortSel, layoutBtns, count),
      chipsRow, list)),
    bulk);
}

// ---------- Resource sheet ----------
const EV = { registry: 'confirmed in registry', curated: 'revisto', manifest: 'declared by the project', documented: 'documentado' };
const METHOD = { plugin: 'Claude Code plugin', skill: 'Claude Code skill', mcp: 'MCP server in Claude Code', package: 'Package manager', download: 'Official installer' };
const TYPE_PT = { bin: 'Executable', app: 'App', brew: 'Homebrew', cask: 'Homebrew Cask', npm: 'npm global', uv: 'uv tool', pipx: 'pipx', pip: 'Python (pip)', cargo: 'Cargo', winget: 'WinGet', scoop: 'Scoop', flatpak: 'Flatpak', mcp: 'MCP server', plugin: 'Plugin', skill: 'Skill', 'account-skill': 'Account skill', dir: 'Folder', env: 'Variable' };

export async function resource(id) {
  const v = await api('resourceView', { id });
  if (!v) return h('div', { class: 'page' }, empty('alert', 'Resource not found', id));
  const { resource: r, profile: pf, presence: pr, actions: A, facts: f } = v;
  const after = () => mount();
  const sub = [pf.kind_label, r.gh_full_name?.split('/')[0], f?.license && f.license !== 'none' ? f.license : null].filter(Boolean);
  const head = h('header', { class: 'sheet-head' }, kindTile(pf.kind, Boolean(pr.state)),
    h('div', null, h('h1', null, r.name), h('div', { class: 'sub' }, sub.map(s => h('span', null, s)), stateChip(v.state))),
    h('div', { class: 'row' }, btn('', () => { compareTray.toggle(r.id); toast(compareTray.has(r.id) ? 'In comparison' : 'Out of comparison'); }, { kind: 'ghost', iconName: 'compare', title: 'Compare' }),
      btn('', e => contextMenu(e.clientX, e.clientY, resourceMenu(r)), { kind: 'ghost', iconName: 'dots', title: 'More' })));

  // Action bar: the one thing to do next, then management, then documentation.
  const lead = A.primary ? null : pr.state ? 'Ready to use.' : pf.kind === 'reference' ? 'Reference material.' : null;
  const bar = h('div', { class: 'actionbar' },
    A.primary ? actionButton(A.primary, r.name, after, { kind: 'primary' }) : !pr.state && A.project.length ? btn('Add to a project', () => addToProject(r.name, A.project).then(after), { kind: 'primary', iconName: 'plus' }) : lead ? h('span', { class: 'lead' }, lead) : null,
    ...A.manage.slice(0, 4).map(a => actionButton(a, r.name, after, { kind: 'ghost' })),
    h('span', { class: 'grow' }),
    ...A.docs.map(a => btn(a.label, () => runAction(a, r.name), { kind: 'ghost', iconName: 'external' })));

  const presence = pr.found.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, pr.found.map(x => h('li', null, icon(x.type === 'mcp' ? 'mcp' : x.type === 'app' ? 'grid' : x.type.includes('skill') ? 'skills' : x.type === 'plugin' ? 'layers' : 'terminal', 'sm'),
    h('div', { class: 'grow' }, h('div', null, `${TYPE_PT[x.type] || x.type} · `, h('span', { class: 'mono' }, x.name)), h('div', { class: 't2' }, [x.agent_label, x.version, x.scope && !['system', 'user'].includes(x.scope) ? x.scope : null, x.managed_by === 'curi' ? 'managed by CURI' : x.managed_by === 'account' ? 'managed by your account' : 'installed outside CURI'].filter(Boolean).join(' · '))),
    x.enabled === false ? h('span', { class: 'state reference' }, 'Disabled') : null)))) : null;

  const options = A.install.length ? h('div', { class: 'box' }, A.install.map(a => h('div', { class: 'opt' },
    h('div', null, h('div', { class: 't' }, a.label), h('div', { class: 's' }, [a.sub, a.evidence ? EV[a.evidence] : null, a.missing ? `falta ${a.missing.join(', ')}` : null, a.secrets?.length ? `key: ${a.secrets.join(', ')}` : null, a.auth === 'oauth' ? 'OAuth sign-in in Claude Code' : null, a.scripts ? 'inclui scripts' : null].filter(Boolean).join(' · '))),
    actionButton({ ...a, label: a.prereq && a.disabled ? a.label : a.op?.kind === 'mcp.add' ? 'Enable' : a.op?.kind === 'package.install' ? 'Install' : a.op?.kind === 'plugin.install' ? 'Install' : a.op?.kind === 'skill.install' ? 'Install' : a.label }, r.name, after, { kind: a === A.primary ? 'primary' : '' }),
    a.setup?.length ? h('ol', { class: 'steps' }, a.setup.map(s => h('li', null, s))) : null))) : null;

  const project = A.project.length ? h('div', { class: 'stack' },
    h('div', { class: 'row' }, btn('Add to a project', () => addToProject(r.name, A.project).then(after), { kind: A.primary || pr.state ? '' : 'primary', iconName: 'plus' }), h('span', { class: 'muted small' }, 'or copy the command:')),
    A.project.map(c => cmdLine(c.command))) : null;
  const mine = await personalPanel(r.id, v.mine || {}, (m, refresh) => { if (refresh) mount(); });
  const assist = A.assist.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, A.assist.map(a => h('li', null, icon('info', 'sm'), h('div', { class: 'grow' }, h('div', null, a.label), a.hint ? h('div', { class: 't2' }, a.hint) : null), btn('Open', () => runAction(a, r.name), { size: 'sm', iconName: 'external' }))))) : null;

  const capsBox = v.capabilities?.length ? h('div', { class: 'capchips' }, v.capabilities.map(c => h('a', { class: 'capchip', href: `#/capabilities?all=1&focus=${encodeURIComponent(c.id)}` }, c.label))) : null;
  const dl = [];
  const fact = (k, val) => { if (val != null && val !== '') dl.push(h('dt', null, k), h('dd', null, val)); };
  if (f) {
    fact('Stars', f.stars != null ? compact(f.stars) : null);
    fact('Last change', f.pushed_at ? relTime(f.pushed_at) : null);
    fact('Latest release', f.latest_release ? `${f.latest_release.tag} · ${fmtDate(f.latest_release.published_at, { dateStyle: 'medium' })}` : null);
    fact('Licence', f.license);
    fact('Language', f.language);
    for (const [k, list] of Object.entries(f.packages || {})) fact(k === 'pypi' ? 'PyPI' : k === 'cask' ? 'Homebrew Cask' : k === 'brew' ? 'Homebrew' : k, list.map(x => `${x.name} ${x.version || ''}`).join(', '));
    if (f.skills) fact('Skills', `${f.skills}${f.internal_skills ? ` (+${f.internal_skills} internal to the repository)` : ''}`);
    if (f.plugins) fact('Plugins', f.plugins);
    if (f.archived) fact('Status', 'Archived');
    fact('Data from', `${f.source === 'web' ? 'site' : 'GitHub'} · ${relTime(f.inspected_at)}`);
  }
  const alts = v.alternatives.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, v.alternatives.map(a => h('li', null, icon(KIND_ICON[a.kind] || 'info', 'sm'),
    h('a', { class: 'grow', href: `#/resource/${encodeURIComponent(a.id)}` }, h('div', null, a.name), h('div', { class: 't2' }, a.related ? 'Works alongside' : `${Math.round(a.overlap * 100)}% of capabilities in common`)),
    ['INSTALLED', 'CONFIGURED'].includes(a.status) ? stateChip('installed') : null))),
    h('div', { style: { padding: '8px 10px 10px' } }, btn('Compare with these', () => { compareTray.clear(); compareTray.add(r.id); v.alternatives.slice(0, 3).forEach(a => compareTray.add(a.id)); go('compare'); }, { kind: 'ghost', size: 'sm', iconName: 'compare' }))) : null;

  const sec = (title, meta, node) => (node ? [h('div', { class: 'sec' }, h('h2', null, title), meta ? h('span', { class: 'meta' }, meta) : null), node] : []);
  return h('div', { class: 'page' }, head, bar,
    h('div', { class: 'sheet' },
      h('div', null,
        ...sec('What it is', null, h('div', { class: 'stack' }, h('p', { class: 'prose' }, r.description || f?.description || 'No verified description.'), h('p', { class: 'prose dim' }, pf.agent_use), pf.notes ? notice('info', pf.notes) : null, r.risk_notes ? notice('warn', r.risk_notes) : null)),
        ...sec('On this device', pr.found.length ? `${pr.found.length} occurrence${pr.found.length > 1 ? 's' : ''}` : null, presence || h('p', { class: 'prose dim' }, v.device.scanned_at ? `Not found in the last scan (${relTime(v.device.scanned_at)}).` : 'No scan yet.')),
        ...sec(pr.state ? 'Other ways to get it' : 'Install or enable', A.install.length ? 'each option runs visibly, with progress and verification' : null, options),
        ...sec('Managed elsewhere', null, assist),
        ...sec('Use in a project', 'runs in the project folder', project)),
      h('div', null,
        ...sec('Yours', 'only on this device', mine),
        ...sec('Facts', null, dl.length ? h('div', { class: 'box pad' }, h('dl', { class: 'facts' }, dl)) : h('p', { class: 'prose dim' }, 'No inspection data.')),
        ...sec('Capabilities', null, capsBox),
        ...sec('Alternatives and companions', null, alts))));
}

// ---------- Compare ----------
export async function compare() {
  const linked = params().get('ids');
  if (linked) { compareTray.clear(); linked.split(',').slice(0, 5).forEach(id => compareTray.add(id)); }
  const ids = [...compareTray.ids];
  if (ids.length < 2) return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Compare'))),
    empty('compare', 'Pick at least two resources', 'In the Library, hover a row and tick the box on the left, or open a resource and use "Compare with these".', btn('Go to Library', () => go('library'), { kind: 'primary' })));
  const p = params();
  const input = h('input', { type: 'search', value: p.get('use') || '', placeholder: 'What for? e.g. "test my site in the browser"', 'aria-label': 'Use case' });
  const out = h('div');
  const load = async () => {
    const r = await api('compareDecision', { ids, useCase: input.value.trim() });
    const it = r.items;
    const rowH = (label, fn) => h('tr', null, h('th', { scope: 'row' }, label), it.map(x => h('td', null, fn(x))));
    const ul = list => (list?.length ? h('ul', null, list.map(s => h('li', null, s))) : h('span', { class: 'muted' }, '—'));
    fill(out,
      r.guidance.length ? h('ul', { class: 'guidance' }, r.guidance.map(g => h('li', { class: g.tone || '' }, icon(g.tone === 'warn' ? 'alert' : 'arrow', 'sm'), h('span', null, g.text)))) : null,
      h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Criterion')), it.map(x => h('th', { scope: 'col' }, h('div', { class: 'colhead' },
          h('a', { href: `#/resource/${encodeURIComponent(x.id)}` }, h('strong', null, x.name)), h('span', { class: 'muted' }, x.kind_label),
          h('div', { class: 'row' }, x.presence.state ? stateChip(x.presence.state) : btn('See options', () => go(`resource/${encodeURIComponent(x.id)}`), { size: 'sm', kind: 'primary', iconName: 'download' }),
            btn('', () => { compareTray.delete(x.id); mount(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Remove' }))))))),
        h('tbody', null,
          rowH('What it does', x => x.description || '—'),
          rowH('How the agent uses it', x => x.agent_use),
          r.use_case ? rowH(`For "${r.use_case}"`, x => (x.matches_use_case?.length ? x.matches_use_case.join(', ') : h('span', { class: 'muted' }, 'doesn\'t cover it directly'))) : null,
          rowH('Only this one offers', x => ul(x.unique)),
          rowH('On this device', x => (x.presence.state ? `${STATE_LABEL[x.presence.state]}${x.presence.where.length ? ` · ${x.presence.where.join(', ')}` : ''}` : 'No')),
          rowH('Install', x => h('div', null, h('div', null, x.install.text), x.install_method ? h('div', { class: 'muted' }, x.install_method) : null, x.steps.length ? ul(x.steps) : null)),
          rowH('Dependencies', x => ul(x.deps)),
          rowH('Security', x => ul(x.security)),
          rowH('Publisher', x => (x.publisher ? `${x.publisher.name}${x.publisher.trusted ? ' · trusted' : ''}` : '—')),
          rowH('Upkeep', x => (x.maintenance ? `${x.maintenance.state}${x.maintenance.pushed_days != null ? ` · ${x.maintenance.pushed_days} days ago` : ''}${x.maintenance.release ? ` · ${x.maintenance.release}` : ''}${x.maintenance.stars != null ? ` · ${compact(x.maintenance.stars)} ★` : ''}` : '—')),
          rowH('Licence', x => x.license),
          it.some(x => x.use_when) ? rowH('When to choose it', x => x.use_when || '—') : null,
          it.some(x => x.avoid_when) ? rowH('When to avoid it', x => x.avoid_when || '—') : null))));
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  await load();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Compare'), h('p', null, 'Concrete differences to help you decide: what each does, what only it does, what it takes to run here, risks and upkeep. No arbitrary scores.')),
      h('div', { class: 'actions' }, btn('Clear', () => { compareTray.clear(); go('library'); }, { kind: 'ghost' }))),
    h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input)), out);
}
