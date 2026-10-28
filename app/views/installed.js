// Installed: everything that's already here, grouped by where it lives. Each agent (Claude Code, the
// claude.ai account, Claude Desktop, Codex, Cursor…) and this computer get their own place, with what
// they hold, where the configuration is, and the actions that make sense there.
import { h, relTime, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runOperation } from './control.js';
import { runAction } from './common.js';
import { noun } from './device.js';

const PLACE_ICON = { account: 'cloud', agent: 'agent', computer: 'device' };
const TYPE_ICON = { 'account-skill': 'skills', skill: 'skills', plugin: 'layers', mcp: 'mcp', app: 'grid' };
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const PAGE = 80;

export async function installedView(onCount) {
  let inv = await api('installed');
  const st = { place: params().get('place') ?? lsGet('curi-inst-place', ''), group: '', q: '', limit: PAGE };
  const side = h('nav', { class: 'inv-places', 'aria-label': 'Where things are installed' });
  const main = h('div', { class: 'inv-main', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', placeholder: 'Find something you installed, anywhere', 'aria-label': 'Search what is installed' });

  const rescan = () => runOperation('system.scan', {}, 'Look at this device again', { refresh: false }).then(async () => { inv = await api('installed'); render(); });
  const match = it => !st.q || `${it.name} ${it.description || ''} ${it.origin || ''} ${it.resource?.name || ''}`.toLowerCase().includes(st.q);
  const total = () => inv.places.reduce((n, p) => n + p.count, 0);

  const row = (it, place) => {
    const tags = [
      it.version ? h('span', { class: 'tg mono' }, it.version) : null,
      it.enabled === false ? h('span', { class: 'tg off' }, 'disabled') : null,
      it.scope && !['user', 'account', 'synced'].includes(it.scope) ? h('span', { class: 'tg' }, it.scope) : null,
      it.origin ? h('span', { class: 'tg' }, it.origin) : null,
    ];
    const acts = it.actions.map(a => btn(a.label, () => (a.type === 'op'
      ? runOperation(a.op.kind, a.op.params, `${a.label} ${it.name}`, { refresh: false }).then(async () => { inv = await api('installed'); render(); })
      : runAction(a, it.name)), { size: 'sm', kind: a.danger ? 'ghost danger' : 'ghost', iconName: a.type === 'open' ? 'external' : a.danger ? 'trash' : null }));
    return h('div', { class: 'inv-row', role: 'listitem' },
      h('span', { class: `inv-ic ${it.enabled === false ? 'off' : ''}`, 'aria-hidden': 'true' }, icon(TYPE_ICON[it.type] || 'terminal', 'sm')),
      h('div', { class: 'inv-what' },
        h('div', { class: 'inv-name' }, h('strong', null, it.name), tags),
        it.description || it.detail ? h('div', { class: `inv-desc ${it.detail && !it.description ? 'mono' : ''}` }, it.description || it.detail) : null,
        st.place === '' && place ? h('div', { class: 'inv-where' }, icon(PLACE_ICON[place.kind], 'sm'), place.label) : null),
      h('div', { class: 'inv-act' },
        it.resource ? h('a', { class: 'btn sm ghost', href: `#/resource/${encodeURIComponent(it.resource.id)}`, title: `In the catalogue as ${it.resource.name}` }, h('span', { class: 'btn-label' }, 'Details'), icon('chevron', 'sm')) : null,
        acts));
  };

  const renderSide = () => fill(side,
    placeBtn({ id: '', label: 'Everywhere', kind: 'all', count: total() }),
    inv.places.map(placeBtn),
    h('div', { class: 'inv-scan' }, h('span', null, inv.scanned_at ? `Checked ${relTime(inv.scanned_at)}` : 'Not checked yet'), btn('Check again', rescan, { size: 'sm', kind: 'ghost', iconName: 'refresh' })));
  function placeBtn(p) {
    const b = h('button', { type: 'button', class: `inv-place ${p.kind}`, 'aria-pressed': String(st.place === p.id) },
      h('span', { class: 'pi' }, icon(p.kind === 'all' ? 'layers' : PLACE_ICON[p.kind] || 'agent', 'sm')),
      h('span', { class: 'pl' }, h('strong', null, p.label), p.groups ? h('span', null, p.groups.map(g => `${g.items.length} ${noun(g.label, g.items.length)}`).join(' · ') || (p.present ? 'nothing installed yet' : '')) : h('span', null, `${inv.places.length} places`)),
      h('span', { class: 'pn' }, String(p.count)));
    b.addEventListener('click', () => { st.place = p.id; st.group = ''; st.limit = PAGE; lsSet('curi-inst-place', p.id); render(); });
    return b;
  }

  const renderMain = () => {
    const places = st.place ? inv.places.filter(p => p.id === st.place) : inv.places;
    const place = st.place ? places[0] : null;
    if (st.place && !place) { st.place = ''; return renderMain(); }
    const groups = place ? place.groups : [];
    input.placeholder = place ? `Search ${place.label}` : 'Find something you installed, anywhere';
    const head = place ? h('header', { class: 'inv-head' },
      h('div', { class: 'grow' }, h('h2', null, place.label), place.note ? h('p', null, place.note) : null,
        place.config ? h('p', { class: 'mono small muted' }, place.config.replace(/^\/Users\/[^/]+/, '~')) : null),
      h('div', { class: 'inv-head-act' },
        place.manage_url ? btn('Open claude.ai settings', () => api('openExternal', { url: place.manage_url }), { size: 'sm', iconName: 'external' }) : null,
        place.config ? btn('Show file', () => api('revealAgentConfig', { agent: place.id }), { size: 'sm', kind: 'ghost', iconName: 'external' }) : null,
        place.kind !== 'computer' ? btn('Get more', () => go('library?tab=catalogue'), { size: 'sm', kind: 'primary', iconName: 'plus' }) : null))
      : h('header', { class: 'inv-head' }, h('div', { class: 'grow' }, h('h2', null, 'Everything installed'), h('p', null, 'Every agent and this computer, in one list. Pick a place on the left to see only what lives there.')));
    const tabs = groups.length > 1 ? h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Kind' }, [['', 'All', place.count], ...groups.map(g => [g.id, g.label, g.items.length])].map(([id, l, n]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.group === id) }, l, h('span', { class: 'n' }, String(n)));
      b.addEventListener('click', () => { st.group = id; st.limit = PAGE; render(); });
      return b;
    })) : null;
    const sections = [];
    let shown = 0, hits = 0;
    for (const p of places) for (const g of p.groups) {
      if (st.group && g.id !== st.group) continue;
      const items = g.items.filter(match);
      hits += items.length;
      if (!items.length || shown >= st.limit) continue;
      const take = items.slice(0, st.limit - shown);
      shown += take.length;
      sections.push(h('section', { class: 'inv-sec' },
        h('h3', null, place ? g.label : `${p.label} · ${g.label}`, h('span', { class: 'n' }, String(items.length))),
        h('div', { class: 'inv-list', role: 'list' }, take.map(it => row(it, p)))));
    }
    fill(main, head, h('div', { class: 'inv-tools' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input), tabs),
      sections.length ? sections : st.q ? empty('search', `Nothing installed matches "${st.q}"`, 'It may not be on this device yet. The catalogue can find and install it.', btn('Search the catalogue', () => go(`library?tab=catalogue&q=${encodeURIComponent(st.q)}`), { kind: 'primary' }))
        : empty('box', 'Nothing here yet', place?.kind === 'agent' && !place.present ? `${place.label} isn't installed on this computer.` : 'Install something from the catalogue and it shows up here.', btn('Browse the catalogue', () => go('library?tab=catalogue'), { kind: 'primary' })),
      hits > shown ? h('div', { class: 'more-row' }, btn(`Show ${Math.min(PAGE, hits - shown)} more`, () => { st.limit += PAGE; render(); }, { kind: 'ghost' })) : null);
  };

  const render = () => { renderSide(); renderMain(); onCount?.(total()); };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = input.value.trim().toLowerCase(); st.limit = PAGE; renderMain(); input.focus(); }, 120); });
  if (!inv.scanned_at) {
    fill(main, empty('device', 'CURI hasn\'t looked at this device yet', 'It reads what your agents and this computer already have. Nothing is changed.', btn('Look now', rescan, { kind: 'primary', iconName: 'refresh' })));
    renderSide();
  } else render();
  return h('div', { class: 'inv' }, side, main);
}
