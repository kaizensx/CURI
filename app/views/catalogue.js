// Catalogue: the front of the Library. Browsing looks like a shop window (one big search, areas to
// wander into, a featured row, shelves by kind); as soon as you search or filter it becomes a grid of
// results with the filters that matter. Every card carries its real state and the one action that fits.
import { h, relTime, compact, fill, reducedMotion } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toast, contextMenu, empty, promptDialog, pager } from '../lib/ui.js';
import { go, params, compareTray, currentMotion } from '../app.js';
import { STATE_HINT } from './common.js';
import { hero, searchCapsule } from './hero.js';
import { resourceMenu, quickAction, quickLabel } from './library.js';
import { kitCard } from './kits.js';

const KINDS = [['', 'Everything'], ['plugin', 'Plugins'], ['skill', 'Skills'], ['mcp', 'MCP servers'], ['cli', 'Command line'], ['app', 'Apps'], ['components', 'UI components'], ['library', 'Libraries'], ['framework', 'Frameworks']];
const KIND_SHELF = { plugin: 'Claude Code plugins', 'skill-pack': 'Skill packs', skill: 'Skills', mcp: 'MCP servers', cli: 'Command-line tools', app: 'Apps', components: 'UI components', library: 'Libraries for your projects', framework: 'Frameworks' };
const KIND_GLYPH = { plugin: 'layers', 'skill-pack': 'skills', skill: 'skills', mcp: 'mcp', cli: 'terminal', app: 'grid', library: 'library', components: 'box', framework: 'library', reference: 'info' };
const AREA_ICON = { agents: 'agent', web: 'compass', engineering: 'terminal', quality: 'check', security: 'shield', re: 'search', data: 'copy', '3d': 'box', video: 'play', audio: 'activity', hardware: 'device', science: 'sparkle', ai: 'sparkle', frontend: 'grid', design: 'layers', motion: 'bolt', graphics: 'box', backend: 'database', mobile: 'device', desktop: 'dashboard', automation: 'refresh', ops: 'settings', discovery: 'radar', business: 'map' };
const SHOW = [['all', 'All'], ['here', 'Yours'], ['ready', 'One click'], ['project', 'For projects'], ['fav', 'Favourites']];
const SORTS = [['smart', 'Best match'], ['stars', 'Most loved'], ['updated', 'Recently active'], ['name', 'A to Z']];
const IDEAS = ['control Blender', 'test my website', 'make videos from code', 'browse the web', 'reverse engineer an app', 'design a UI'];
const HERE = ['installed', 'configured', 'account'];
const DAY = 864e5;
// Short state labels for cards; the full wording lives on the resource page.
const SHORT = { installed: 'Installed', configured: 'Connected', account: 'On claude.ai' };
const chip = st => h('span', { class: `state ${st}`, title: STATE_HINT[st] || '' }, SHORT[st] || st);
const smooth = () => (reducedMotion() || currentMotion() !== 'full' ? 'auto' : 'smooth');
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// Every resource gets its own colour, stable across sessions: an app icon without a logo to borrow.
function hue(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function art(r, size = '') {
  const t = h('span', { class: `art ${size}`, 'aria-hidden': 'true' }, icon(KIND_GLYPH[r.kind] || 'box'));
  t.style.setProperty('--h', hue(r.id));
  return t;
}
const owner = r => (r.gh_full_name ? r.gh_full_name.split('/')[0] : (() => { try { return new URL(r.canonical_url).hostname.replace(/^www\./, ''); } catch { return ''; } })());

export async function catalogueView(tabs) {
  const p = params();
  const [everything, capMap, cols, kits] = await Promise.all([api('library'), api('capabilityMap'), api('collections'), api('kits')]);
  const actionable = r => Boolean(r.state || r.installable || r.has_project);
  const all = everything.filter(actionable);
  const capDomain = new Map(capMap.capabilities.map(c => [c.id, c.domain]));
  const prep = list => { for (const r of list) r.domains = [...new Set(r.capabilities.map(c => capDomain.get(c)).filter(Boolean))]; };
  prep(all);
  const st = { show: p.get('view') || 'all', kind: p.get('kind') || '', domain: p.get('domain') || '', col: p.get('col') || '', origin: '', upkeep: '', q: p.get('q') || '', sort: lsGet('curi-cat-sort', 'smart'), page: 0, sel: new Set(), hidden: false };
  let ranked = null, searchError = null;

  const kindOf = r => (r.kind === 'skill-pack' ? 'skill' : r.kind);
  const inShow = (r, v = st.show) => v === 'all' || (v === 'here' && HERE.includes(r.state)) || (v === 'ready' && !r.state && r.ready) || (v === 'project' && ['library', 'framework', 'components'].includes(r.kind)) || (v === 'fav' && r.mine.fav);
  const passes = r => (st.hidden ? r.mine.hidden : !r.mine.hidden) && inShow(r) && (!st.kind || kindOf(r) === st.kind) && (!st.domain || r.domains.includes(st.domain)) && (!st.col || (r.mine.collections || []).includes(st.col))
    && (!st.origin || (st.origin === 'github' ? r.gh_full_name : !r.gh_full_name))
    && (!st.upkeep || (st.upkeep === 'active' ? r.pushed_at && Date.now() - new Date(r.pushed_at) < 90 * DAY : r.pushed_at && Date.now() - new Date(r.pushed_at) > 365 * DAY));
  const browsing = () => st.q.length < 2 && st.show === 'all' && !st.kind && !st.domain && !st.col && !st.origin && !st.upkeep && !st.hidden;
  const visible = all.filter(r => !r.mine.hidden);

  const reload = async () => { const fresh = (await api('library')).filter(actionable); prep(fresh); all.splice(0, all.length, ...fresh); render(); };
  const toggleFav = async r => { r.mine = await api('mark', { id: r.id, patch: { fav: !r.mine.fav } }); render(); };
  const open = r => go(`resource/${encodeURIComponent(r.id)}`);
  const menuFor = r => [...resourceMenu(r), '-',
    { label: r.mine.fav ? 'Remove from favourites' : 'Favourite', icon: 'star', run: () => toggleFav(r) },
    { label: st.sel.has(r.id) ? 'Deselect' : 'Select', icon: 'check', run: () => { st.sel.has(r.id) ? st.sel.delete(r.id) : st.sel.add(r.id); render(); } },
    { label: r.mine.hidden ? 'Show again' : 'Hide', icon: 'x', run: async () => { r.mine = await api('mark', { id: r.id, patch: { hidden: !r.mine.hidden } }); render(); } }];

  // The action on a card: "Open" for what's yours, otherwise the one thing that gets it here.
  const action = (r, size = 'sm') => {
    if (HERE.includes(r.state)) return btn('Open', () => open(r), { size, kind: 'pill' });
    const [label, ic] = quickLabel(r);
    return btn(label === 'Manage' ? 'View' : label, () => quickAction(r, reload), { size, kind: label === 'Manage' ? 'pill' : 'pill get', iconName: label === 'Manage' ? null : ic });
  };
  const wire = (el, r) => {
    el.addEventListener('click', e => { if (e.metaKey || e.ctrlKey) { st.sel.has(r.id) ? st.sel.delete(r.id) : st.sel.add(r.id); render(); return; } if (!e.target.closest('button')) open(r); });
    el.addEventListener('keydown', e => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r); }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const b = el.getBoundingClientRect(); contextMenu(b.left + 24, b.top + 24, menuFor(r)); }
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, menuFor(r)); });
    return el;
  };
  const fav = r => {
    const b = h('button', { type: 'button', class: `fav ${r.mine.fav ? 'on' : ''}`, 'aria-pressed': String(Boolean(r.mine.fav)), 'aria-label': r.mine.fav ? 'Remove from favourites' : 'Favourite' }, icon('star', 'sm'));
    b.addEventListener('click', e => { e.stopPropagation(); toggleFav(r); });
    return b;
  };
  // Everything the right-click menu does, reachable from the keyboard too.
  const more = r => {
    const b = h('button', { type: 'button', class: 'more', 'aria-label': `More actions for ${r.name}`, 'aria-haspopup': 'menu', title: 'More' }, icon('dots', 'sm'));
    b.addEventListener('click', e => { e.stopPropagation(); const x = b.getBoundingClientRect(); contextMenu(x.left, x.bottom + 6, menuFor(r)); });
    return b;
  };
  const card = r => wire(h('article', { class: `gcard ${st.sel.has(r.id) ? 'sel' : ''} ${r.state ? 'mine' : ''}`, tabindex: '0', role: 'listitem', 'aria-label': `${r.name}, ${r.kind_label}${r.state ? `, ${SHORT[r.state] || r.state}` : ''}` },
    h('div', { class: 'g-top' }, art(r), h('div', { class: 'g-id' }, h('strong', null, r.name), h('span', null, r.kind_label, owner(r) ? h('i', null, ` · ${owner(r)}`) : null)), fav(r), more(r)),
    h('p', null, r.description || ''),
    h('div', { class: 'g-foot' },
      h('div', { class: 'g-meta' }, r.stars != null ? h('span', null, icon('star', 'sm'), compact(r.stars)) : null, r.pushed_at && !r.state ? h('span', null, relTime(r.pushed_at)) : null),
      r.state ? chip(r.state) : null, action(r))), r);
  const feature = r => wire(h('article', { class: 'shelf-feature', tabindex: '0', 'aria-label': r.name, vars: { '--h': hue(r.id) } },
    h('div', { class: 'f-art', 'aria-hidden': 'true' }, h('i'), h('i'), icon(KIND_GLYPH[r.kind] || 'box')),
    h('div', { class: 'f-body' },
      h('span', { class: 'f-eyebrow' }, r.state ? 'Already yours' : r.ready ? 'Ready in one click' : r.kind_label),
      h('strong', null, r.name),
      h('p', null, r.description || ''),
      h('div', { class: 'f-foot' }, art(r, 'sm'), h('span', { class: 'f-by' }, r.kind_label, h('br'), h('i', null, r.stars != null ? `★ ${compact(r.stars)}` : owner(r))), action(r, 'md')))), r);
  const shelf = (title, sub, rows, seeAll) => {
    if (!rows.length) return null;
    const row = h('div', { class: 'shelf-row', role: 'list' }, rows.map(card));
    const step = dir => row.scrollBy({ left: dir * row.clientWidth * 0.9, behavior: smooth() });
    return h('section', { class: 'shelf' },
      h('header', null, h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null),
        seeAll ? btn('See all', seeAll, { size: 'sm', kind: 'ghost', iconName: 'chevron' }) : null,
        h('div', { class: 'shelf-nav' }, btn('', () => step(-1), { size: 'sm', iconName: 'chevron', title: 'Previous' }), btn('', () => step(1), { size: 'sm', iconName: 'chevron', title: 'Next' }))),
      row);
  };

  // ---------- chrome ----------
  const input = h('input', { type: 'search', id: 'page-search', value: st.q, maxlength: '200', placeholder: 'What should your agents be able to do?', 'aria-label': 'Search the catalogue', autocomplete: 'off', spellcheck: 'false' });
  const clear = h('button', { type: 'button', class: 'cat-clear', 'aria-label': 'Clear search', hidden: !st.q }, icon('x', 'sm'));
  clear.addEventListener('click', () => { input.value = ''; search(); input.focus(); });
  const ideas = h('div', { class: 'cat-ideas' }, h('span', null, 'Try'), IDEAS.map(t => { const b = h('button', { type: 'button' }, t); b.addEventListener('click', () => { input.value = t; search(); }); return b; }));
  const areas = h('div', { class: 'cat-areas', role: 'group', 'aria-label': 'Areas' });
  const kinds = h('div', { class: 'tabs cat-kinds', role: 'group', 'aria-label': 'Kind' });
  const tools = h('div', { class: 'cat-tools' });
  const body = h('div', { class: 'cat-body' });
  // One quiet announcement per change, instead of re-reading the whole grid.
  const announce = h('p', { class: 'sr-only', role: 'status' });
  const bulk = h('div');

  const renderAreas = () => {
    const counts = capMap.domains.map(d => [d, visible.filter(r => r.domains.includes(d.id)).length]).filter(([, c]) => c).sort((a, b) => b[1] - a[1]);
    fill(areas, counts.map(([d, c]) => {
      const b = h('button', { type: 'button', class: 'area', 'aria-pressed': String(st.domain === d.id), title: d.sub }, h('span', { class: 'ai' }, icon(AREA_ICON[d.id] || 'sparkle', 'sm')), h('span', null, d.label), h('span', { class: 'n' }, c));
      b.addEventListener('click', () => { st.domain = st.domain === d.id ? '' : d.id; st.page = 0; render(); });
      return b;
    }));
  };
  const renderKinds = () => fill(kinds, KINDS.map(([k, l]) => {
    const n = k ? visible.filter(r => kindOf(r) === k).length : visible.length;
    if (k && !n) return null;
    const b = h('button', { type: 'button', 'aria-pressed': String(st.kind === k) }, l);
    b.addEventListener('click', () => { st.kind = k; st.page = 0; render(); });
    return b;
  }));
  const moreFilters = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const myCols = [...new Set([...cols.map(c => c.name), ...all.flatMap(x => x.mine.collections || [])])];
    const tick = on => (on ? 'check' : null);
    contextMenu(r.left, r.bottom + 6, [
      ...myCols.map(c => ({ label: `Collection: ${c}`, icon: tick(st.col === c) || 'layers', run: () => { st.col = st.col === c ? '' : c; render(); } })),
      { label: 'New collection…', icon: 'plus', run: async () => { const name = await promptDialog({ title: 'New collection', placeholder: 'e.g. Client project, To try', confirm: 'Create' }); const n = name?.trim().slice(0, 40); if (n) { await api('collectionAdd', { name: n }); cols.push({ name: n }); render(); } } },
      '-',
      { label: 'From GitHub', icon: tick(st.origin === 'github') || 'git', run: () => { st.origin = st.origin === 'github' ? '' : 'github'; render(); } },
      { label: 'From websites', icon: tick(st.origin === 'web') || 'external', run: () => { st.origin = st.origin === 'web' ? '' : 'web'; render(); } },
      { label: 'Active in the last 90 days', icon: tick(st.upkeep === 'active') || 'activity', run: () => { st.upkeep = st.upkeep === 'active' ? '' : 'active'; render(); } },
      { label: 'Quiet for over a year', icon: tick(st.upkeep === 'stale') || 'clock', run: () => { st.upkeep = st.upkeep === 'stale' ? '' : 'stale'; render(); } },
      '-',
      { label: st.hidden ? 'Back to the catalogue' : `Hidden (${all.filter(x => x.mine.hidden).length})`, icon: 'x', run: () => { st.hidden = !st.hidden; render(); } },
    ]);
  };
  const renderTools = rows => {
    const sortSel = h('select', { class: 'select', 'aria-label': 'Sort' }, SORTS.map(([v, l]) => h('option', { value: v, selected: st.sort === v || null }, l)));
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; lsSet('curi-cat-sort', st.sort); render(); });
    const show = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show' }, SHOW.map(([v, l]) => { const b = h('button', { type: 'button', 'aria-pressed': String(st.show === v) }, l); b.addEventListener('click', () => { st.show = v; st.page = 0; render(); }); return b; }));
    const extra = [st.col && `Collection: ${st.col}`, st.origin && (st.origin === 'github' ? 'GitHub' : 'Websites'), st.upkeep && (st.upkeep === 'active' ? 'Active' : 'Quiet'), st.hidden && 'Hidden', st.domain && capMap.domains.find(d => d.id === st.domain)?.label].filter(Boolean);
    const filtersBtn = btn(extra.length ? `Filters · ${extra.length}` : 'Filters', moreFilters, { size: 'sm', iconName: 'filter' });
    fill(tools, h('div', { class: 'cat-count' }, h('strong', null, String(rows.length)), ` ${rows.length === 1 ? 'result' : 'results'}`, extra.length ? h('span', { class: 'muted' }, ` · ${extra.join(' · ')}`) : null),
      show, filtersBtn, sortSel,
      browsing() ? null : btn('Reset', () => { Object.assign(st, { show: 'all', kind: '', domain: '', col: '', origin: '', upkeep: '', hidden: false, page: 0 }); input.value = ''; ranked = null; st.q = ''; render(); }, { size: 'sm', kind: 'ghost' }));
  };
  const renderBulk = () => {
    const rows = all.filter(r => st.sel.has(r.id));
    const ready = rows.filter(r => !r.state && r.ready);
    fill(bulk, rows.length ? h('div', { class: 'tray', role: 'region', 'aria-label': 'Selection' },
      h('span', { class: 'names' }, `${rows.length} selected`),
      btn('Compare', () => { compareTray.clear(); rows.slice(0, 5).forEach(r => compareTray.add(r.id)); go('compare'); }, { size: 'sm', iconName: 'compare', disabled: rows.length < 2 }),
      btn('Collection', async () => { const name = await promptDialog({ title: `Add ${rows.length} to a collection`, placeholder: 'collection name', confirm: 'Add' }); if (!name?.trim()) return; for (const r of rows) r.mine = await api('mark', { id: r.id, patch: { collections: [...(r.mine.collections || []), name.trim()] } }); if (!cols.some(c => c.name === name.trim())) cols.push({ name: name.trim() }); toast(`${rows.length} in "${name.trim()}"`, 'good'); render(); }, { size: 'sm', iconName: 'layers' }),
      ready.length ? btn(`Get ${ready.length}`, async () => { for (const r of ready) await quickAction(r, () => {}); st.sel.clear(); reload(); }, { size: 'sm', kind: 'primary', iconName: 'download' }) : null,
      btn('', () => { st.sel.clear(); render(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Clear selection' })) : null);
  };

  const sorted = rows => {
    if (ranked && st.sort === 'smart') { const pos = new Map(ranked.map((id, i) => [id, i])); return rows.filter(r => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)); }
    if (ranked) { const ok = new Set(ranked); rows = rows.filter(r => ok.has(r.id)); }
    const cmp = { name: (a, b) => a.name.localeCompare(b.name), stars: (a, b) => (b.stars ?? -1) - (a.stars ?? -1), updated: (a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''),
      smart: (a, b) => (Boolean(b.mine.fav) - Boolean(a.mine.fav)) || (b.stars ?? 0) - (a.stars ?? 0) };
    return rows.sort(cmp[st.sort] || cmp.smart);
  };

  const render = () => {
    renderAreas(); renderKinds(); renderBulk();
    page?.classList.toggle('searching', !browsing());
    clear.hidden = !input.value;
    ideas.hidden = Boolean(st.q);
    if (browsing()) {
      tools.hidden = true;
      const byStars = (a, b) => (b.stars ?? 0) - (a.stars ?? 0);
      const oneClick = visible.filter(r => !r.state && r.ready).sort(byStars);
      const yours = visible.filter(r => HERE.includes(r.state)).sort(byStars);
      const featured = [...oneClick.slice(0, 2), ...yours.slice(0, 1)];
      const recent = visible.filter(r => !r.state && r.pushed_at && Date.now() - new Date(r.pushed_at) < 14 * DAY).sort(byStars).slice(0, 12);
      const kindsShown = ['plugin', 'mcp', 'cli', 'skill', 'components', 'app', 'library'];
      fill(body,
        featured.length ? h('div', { class: 'features' }, featured.map(feature)) : null,
        h('section', { class: 'shelf' }, h('header', null, h('div', null, h('h2', null, 'Kits'), h('p', null, 'A few tools that work well together, installed in one go.'))),
          h('div', { class: 'shelf-row', role: 'list' }, kits.map(k => kitCard(k, everything)))),
        shelf('Ready in one click', 'Not on this computer yet, and nothing else to set up first.', oneClick.slice(2, 16), () => { st.show = 'ready'; render(); }),
        shelf('Already yours', 'In Claude Code, Codex, your claude.ai account or on this computer.', yours.slice(1, 15), () => { st.show = 'here'; render(); }),
        shelf('Busy lately', 'Projects that shipped something in the last two weeks.', recent, () => { st.upkeep = 'active'; st.sort = 'updated'; render(); }),
        kindsShown.map(k => { const rows = visible.filter(r => kindOf(r) === k).sort(byStars); return rows.length > 2 ? shelf(KIND_SHELF[k], null, rows.slice(0, 14), () => { st.kind = k; render(); }) : null; }));
      return;
    }
    tools.hidden = false;
    if (searchError) { renderTools([]); announce.textContent = 'Search didn\'t work'; fill(body, empty('alert', 'Search didn\'t work', searchError, btn('Try again', () => search(), { iconName: 'refresh' }))); return; }
    const rows = sorted(all.filter(passes));
    renderTools(rows);
    announce.textContent = `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`;
    if (st.page * 48 >= rows.length) st.page = 0;
    fill(body, rows.length ? h('div', { class: 'cat-grid', role: 'list' }, rows.slice(st.page * 48, (st.page + 1) * 48).map(card))
      : empty('search', 'Nothing here yet', ranked ? 'Nothing in the catalogue matches. New on GitHub can look for it.' : 'Try another area or kind.', ranked ? btn('Search GitHub', () => go(`discover?intent=${encodeURIComponent(st.q)}`), { iconName: 'radar' }) : null),
      pager(rows.length, st.page, 48, n => { st.page = n; render(); body.scrollIntoView({ block: 'start', behavior: smooth() }); }, { noun: 'resources' }));
  };

  let page = null, timer, seq = 0;
  const search = async () => {
    st.q = input.value.trim(); st.page = 0;
    const my = ++seq;
    searchError = null;
    if (st.q.length < 2) { ranked = null; render(); return; }
    try {
      const r = await api('search', { query: st.q, limit: 100 });
      if (my !== seq) return;
      ranked = r.results.map(x => x.id);
    } catch (e) {
      if (my !== seq) return;
      ranked = null; searchError = e.message;
    }
    render();
  };
  input.addEventListener('input', () => { clear.hidden = !input.value; clearTimeout(timer); timer = setTimeout(search, 160); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; search(); } });
  const here = visible.filter(r => HERE.includes(r.state)).length;
  const ready = visible.filter(r => !r.state && r.ready).length;
  page = h('div', { class: 'page cat' },
    hero({ eyebrow: 'Library', title: 'Give your agents ', em: 'new abilities.', actions: [btn('Add URL', () => window.__curiMenu('add-url-dialog'), { kind: 'ghost', iconName: 'plus', size: 'sm' }), tabs],
      sub: `${visible.length} checked resources. ${here} are already yours, ${ready} install in one click, the rest go into your projects.`,
      search: searchCapsule(input, clear, h('kbd', null, '/')), after: ideas }),
    areas,
    h('div', { class: 'cat-bar' }, h('div', { class: 'cat-bar-in' }, kinds, tools)),
    body, announce, bulk);
  if (st.q) search(); else render();
  return page;
}
