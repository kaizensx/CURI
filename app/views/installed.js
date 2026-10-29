// Installed: everything that's already here, grouped by where it lives. Each agent (Claude Code, the
// claude.ai account, Claude Desktop, Codex, Cursor…) and this computer get their own place, with what
// they hold, where the configuration is, and the actions that make sense there. "Recently added" puts
// every place on one timeline, so something installed from Claude Code or claude.ai is easy to find.
import { h, relTime, fmtDate, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, pager } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runOperation } from './control.js';
import { runAction } from './common.js';
import { noun } from './device.js';

const PLACE_ICON = { account: 'cloud', agent: 'agent', computer: 'device', recent: 'clock', all: 'layers' };
const TYPE_ICON = { 'account-skill': 'skills', skill: 'skills', plugin: 'layers', mcp: 'mcp', app: 'grid' };
const TYPE_WORD = { 'account-skill': 'skill', skill: 'skill', plugin: 'plugin', mcp: 'MCP server', app: 'app' };
const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '3 months']];
const WHO = [['', 'Everywhere'], ['claude', 'Claude (Code + claude.ai)'], ['agents', 'All agents'], ['computer', 'This computer']];
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const SIZE = 40;

export async function installedView(onCount) {
  let inv = await api('installed');
  const st = { place: params().get('place') ?? lsGet('curi-inst-place', 'recent'), group: '', q: '', page: 0,
    sort: lsGet('curi-inst-sort', 'name'), days: Number(lsGet('curi-inst-days', '30')), who: lsGet('curi-inst-who', 'claude') };
  const side = h('nav', { class: 'inv-places', 'aria-label': 'Where things are installed' });
  const main = h('div', { class: 'inv-main', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', placeholder: 'Find something you installed, anywhere', 'aria-label': 'Search what is installed' });

  const reload = async () => { inv = await api('installed'); render(); };
  const rescan = () => runOperation('system.scan', {}, 'Look at this device again', { refresh: false }).then(reload);
  const match = it => !st.q || `${it.name} ${it.description || ''} ${it.origin || ''} ${it.resource?.name || ''}`.toLowerCase().includes(st.q);
  const total = () => inv.places.reduce((n, p) => n + p.count, 0);
  const cutoff = () => Date.now() - st.days * 864e5;
  const whoOk = p => !st.who || (st.who === 'claude' ? ['claude-code', 'claude-account'].includes(p.id) : st.who === 'agents' ? p.kind !== 'computer' : p.kind === 'computer');
  const recent = () => inv.places.filter(whoOk).flatMap(p => p.groups.flatMap(g => g.items.filter(it => it.added_at && new Date(it.added_at) >= cutoff()).map(it => ({ it, p, g }))))
    .sort((a, b) => b.it.added_at.localeCompare(a.it.added_at));

  const row = (it, place, showPlace) => {
    const tags = [
      it.version ? h('span', { class: 'tg mono' }, it.version) : null,
      it.enabled === false ? h('span', { class: 'tg off' }, 'disabled') : null,
      it.scope && !['user', 'account', 'synced'].includes(it.scope) ? h('span', { class: 'tg' }, it.scope) : null,
      it.origin ? h('span', { class: 'tg' }, it.origin) : null,
    ];
    const acts = it.actions.map(a => btn(a.label, () => (a.type === 'op'
      ? runOperation(a.op.kind, a.op.params, `${a.label} ${it.name}`, { refresh: false }).then(reload)
      : runAction(a, it.name)), { size: 'sm', kind: a.danger ? 'ghost danger' : 'ghost', iconName: a.type === 'open' ? 'external' : a.danger ? 'trash' : null }));
    return h('div', { class: 'inv-row', role: 'listitem' },
      h('span', { class: `inv-ic ${it.enabled === false ? 'off' : ''}`, 'aria-hidden': 'true' }, icon(TYPE_ICON[it.type] || 'terminal', 'sm')),
      h('div', { class: 'inv-what' },
        h('div', { class: 'inv-name' }, h('strong', null, it.name), tags),
        it.description || it.detail ? h('div', { class: `inv-desc ${it.detail && !it.description ? 'mono' : ''}` }, it.description || it.detail) : null,
        showPlace || it.added_at ? h('div', { class: 'inv-where' },
          showPlace ? [icon(PLACE_ICON[place.kind], 'sm'), h('span', null, `${TYPE_WORD[it.type] || it.type} in ${place.label}`)] : null,
          it.added_at ? h('span', { class: 'when', title: fmtDate(it.added_at, { dateStyle: 'long', timeStyle: 'short' }) }, `${showPlace ? ' · ' : ''}added ${relTime(it.added_at)}`) : null) : null),
      h('div', { class: 'inv-act' },
        it.resource ? h('a', { class: 'btn sm ghost', href: `#/resource/${encodeURIComponent(it.resource.id)}`, title: `In the catalogue as ${it.resource.name}` }, h('span', { class: 'btn-content' }, 'Details', icon('chevron', 'sm'))) : null,
        acts));
  };

  const pick = (id, extra = {}) => { Object.assign(st, { place: id, group: '', page: 0 }, extra); lsSet('curi-inst-place', id); render(); };
  function placeBtn(p) {
    const b = h('button', { type: 'button', class: `inv-place ${p.kind}`, 'aria-pressed': String(st.place === p.id) },
      h('span', { class: 'pi' }, icon(PLACE_ICON[p.kind] || 'agent', 'sm')),
      h('span', { class: 'pl' }, h('strong', null, p.label), h('span', null, p.sub ?? (p.groups.map(g => `${g.items.length} ${noun(g.label, g.items.length)}`).join(' · ') || (p.present ? 'nothing installed yet' : '')))),
      h('span', { class: 'pn' }, String(p.count)));
    b.addEventListener('click', () => pick(p.id));
    return b;
  }
  const renderSide = () => {
    const week = inv.places.flatMap(p => p.groups.flatMap(g => g.items)).filter(it => it.added_at && Date.now() - new Date(it.added_at) < 7 * 864e5).length;
    fill(side,
      placeBtn({ id: 'recent', label: 'Recently added', kind: 'recent', count: week, sub: 'newest first, every place' }),
      placeBtn({ id: '', label: 'Everywhere', kind: 'all', count: total(), sub: `${inv.places.length} places` }),
      h('span', { class: 'micro inv-side-head' }, 'Places'),
      inv.places.map(placeBtn),
      h('div', { class: 'inv-scan' }, h('span', null, inv.scanned_at ? `Checked ${relTime(inv.scanned_at)}` : 'Not checked yet'), btn('Check again', rescan, { size: 'sm', kind: 'ghost', iconName: 'refresh' })));
  };

  const seg = (opts, cur, set, label) => h('div', { class: 'tabs', role: 'group', 'aria-label': label }, opts.map(([v, l, n]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(cur === v) }, l, n != null ? h('span', { class: 'n' }, String(n)) : null);
    b.addEventListener('click', () => { set(v); st.page = 0; render(); });
    return b;
  }));
  const paged = (rows, draw) => {
    const pages = Math.max(1, Math.ceil(rows.length / SIZE));
    if (st.page >= pages) st.page = pages - 1;
    return [draw(rows.slice(st.page * SIZE, (st.page + 1) * SIZE)), pager(rows.length, st.page, SIZE, n => { st.page = n; render(); main.scrollIntoView({ block: 'start' }); }, { noun: 'things' })];
  };

  const renderRecent = () => {
    const rows = recent().filter(x => match(x.it));
    fill(main,
      h('header', { class: 'inv-head' }, h('div', { class: 'grow' }, h('h2', null, 'Recently added'),
        h('p', null, 'What arrived lately, newest first, from every place: a plugin added in Claude Code, a skill added on claude.ai, a tool installed from the terminal.'))),
      h('div', { class: 'inv-tools' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input),
        seg(WHO.map(([v, l]) => [v, l]), st.who, v => { st.who = v; lsSet('curi-inst-who', v); }, 'Where'),
        seg(PERIODS.map(([v, l]) => [v, l]), st.days, v => { st.days = v; lsSet('curi-inst-days', String(v)); }, 'Period')),
      rows.length ? paged(rows, take => h('div', { class: 'inv-list', role: 'list' }, take.map(x => row(x.it, x.p, true))))
        : empty('clock', `Nothing new in the last ${PERIODS.find(p => p[0] === st.days)[1]}`, 'Things installed before CURI first looked at this device have no date. Try a longer period or another place.',
          btn('Show everything', () => pick(''), { kind: 'primary' })));
  };

  const renderMain = () => {
    if (st.place === 'recent') return renderRecent();
    const places = st.place ? inv.places.filter(p => p.id === st.place) : inv.places;
    const place = st.place ? places[0] : null;
    if (st.place && !place) { st.place = ''; return renderMain(); }
    input.placeholder = place ? `Search ${place.label}` : 'Find something you installed, anywhere';
    const groups = place ? place.groups : [];
    const head = place ? h('header', { class: 'inv-head' },
      h('div', { class: 'grow' }, h('h2', null, place.label), place.note ? h('p', null, place.note) : null,
        place.config ? h('p', { class: 'mono small muted' }, place.config.replace(/^\/Users\/[^/]+/, '~')) : null),
      h('div', { class: 'inv-head-act' },
        place.manage_url ? btn('Open claude.ai settings', () => api('openExternal', { url: place.manage_url }), { size: 'sm', iconName: 'external' }) : null,
        place.config ? btn('Show file', () => api('revealAgentConfig', { agent: place.id }), { size: 'sm', kind: 'ghost', iconName: 'external' }) : null,
        place.kind !== 'computer' ? btn('Get more', () => go('library?tab=catalogue'), { size: 'sm', kind: 'primary', iconName: 'plus' }) : null))
      : h('header', { class: 'inv-head' }, h('div', { class: 'grow' }, h('h2', null, 'Everything installed'), h('p', null, 'Every agent and this computer, in one list. Pick a place on the left to see only what lives there.')));
    const tabs = groups.length > 1 ? seg([['', 'All', place.count], ...groups.map(g => [g.id, g.label, g.items.length])], st.group, v => { st.group = v; }, 'Kind') : null;
    const sort = seg([['name', 'A–Z'], ['new', 'Newest']], st.sort, v => { st.sort = v; lsSet('curi-inst-sort', v); }, 'Sort');
    let rows = places.flatMap(p => p.groups.filter(g => !st.group || g.id === st.group).flatMap(g => g.items.filter(match).map(it => ({ it, p, g }))));
    if (st.sort === 'new') rows = rows.sort((a, b) => (b.it.added_at || '').localeCompare(a.it.added_at || ''));
    // Rows on the current page, cut into their sections (by group, or one list when sorted by date).
    const draw = take => {
      if (st.sort === 'new') return h('div', { class: 'inv-list', role: 'list' }, take.map(x => row(x.it, x.p, !place)));
      const out = [];
      for (const x of take) {
        const key = `${x.p.id}|${x.g.id}`;
        if (out.at(-1)?.key !== key) out.push({ key, label: place ? x.g.label : `${x.p.label} · ${x.g.label}`, n: x.g.items.filter(match).length, rows: [] });
        out.at(-1).rows.push(row(x.it, x.p, false));
      }
      return out.map(s => h('section', { class: 'inv-sec' }, h('h3', null, s.label, h('span', { class: 'n' }, String(s.n))), h('div', { class: 'inv-list', role: 'list' }, s.rows)));
    };
    fill(main, head, h('div', { class: 'inv-tools' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input), tabs, sort),
      rows.length ? paged(rows, draw)
        : st.q ? empty('search', `Nothing installed matches "${st.q}"`, 'It may not be on this device yet. The catalogue can find and install it.', btn('Search the catalogue', () => go(`library?tab=catalogue&q=${encodeURIComponent(st.q)}`), { kind: 'primary' }))
        : empty('box', 'Nothing here yet', place?.kind === 'agent' && !place.present ? `${place.label} isn't installed on this computer.` : 'Install something from the catalogue and it shows up here.', btn('Browse the catalogue', () => go('library?tab=catalogue'), { kind: 'primary' })));
  };

  const render = () => { renderSide(); renderMain(); onCount?.(total()); };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = input.value.trim().toLowerCase(); st.page = 0; renderMain(); input.focus(); }, 120); });
  if (!inv.scanned_at) {
    fill(main, empty('device', 'CURI hasn\'t looked at this device yet', 'It reads what your agents and this computer already have. Nothing is changed.', btn('Look now', rescan, { kind: 'primary', iconName: 'refresh' })));
    renderSide();
  } else render();
  return h('div', { class: 'inv' }, side, main);
}
