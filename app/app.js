// CURI shell: routing, navigation, command palette, global shortcuts, native-menu bridge,
// drag-and-drop, theme, and long-running job watching. Views live in ./views/.
import { h, reducedMotion, fill } from './lib/dom.js';
import { icon, brandMark } from './lib/icons.js';
import { api, TOKEN, toast, status, empty, skeleton } from './lib/ui.js';
import { library, resource, compare as compareView, TYPE_ICON } from './views/library.js';
import { welcome, wizard } from './views/onboarding.js';
import { skills, mcp, bridge, security } from './views/manage.js';
import { jobs, audit, settings, about } from './views/system.js';
import { connections, integrations, automation, operations } from './views/control.js';
import { home } from './views/home.js';
import { capabilitiesView } from './views/capabilities.js';
import { device } from './views/device.js';
import { discoverView } from './views/discover.js';
import { promptDialog } from './lib/ui.js';
import { startWatcher, withProgress } from './lib/opmodal.js';

// ---------- environment ----------
const q = new URLSearchParams(location.search);
if (q.get('native') === '1') sessionStorage.setItem('curi-native', '1');
if (sessionStorage.getItem('curi-native') === '1') document.documentElement.classList.add('native');

// ---------- theme ----------
export const currentTheme = () => { try { return localStorage.getItem('curi-theme') || 'system'; } catch { return 'system'; } };
export function applyTheme(t) {
  try { localStorage.setItem('curi-theme', t); } catch {}
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}
applyTheme(currentTheme());
export const currentMotion = () => { try { return localStorage.getItem('curi-motion') || 'full'; } catch { return 'full'; } };
export function applyMotion(m) {
  try { localStorage.setItem('curi-motion', m); } catch {}
  if (m === 'full') document.documentElement.removeAttribute('data-motion'); else document.documentElement.setAttribute('data-motion', m);
}
applyMotion(currentMotion());

// ---------- routes ----------
// Information architecture: five places for the job (see what you have, find, understand, get it, connect),
// two for the system. Older sections stay reachable as tabs or deep links, never as clutter in the sidebar.
const ACTIVITY_TABS = [['operations', 'Operations'], ['audit', 'Audit log'], ['jobs', 'Searches and quotas']];
const SETTINGS_TABS = [['settings', 'General'], ['automation', 'Autonomy'], ['bridge', 'Claude integration'], ['security', 'Security'], ['about', 'About']];
const tabbed = (tabs, view) => async (...a) => {
  const page = await view(...a);
  const cur = location.hash.replace(/^#\//, '').split(/[/?]/)[0];
  const nav = h('nav', { class: 'tabs hub-tabs', 'aria-label': 'Sections' }, tabs.map(([id, l]) => h('a', { href: `#/${id}`, 'aria-current': id === cur ? 'page' : null }, l)));
  const head = page.querySelector?.('.page-head');
  if (head) head.after(nav); else page.prepend?.(nav);
  return page;
};
const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', group: 'CURI', view: home, key: '1' },
  { id: 'library', label: 'Library', icon: 'library', group: 'CURI', view: library, key: '2' },
  { id: 'discover', label: 'Discover', icon: 'radar', group: 'CURI', view: discoverView, key: '3' },
  { id: 'capabilities', label: 'Capabilities', icon: 'map', group: 'CURI', view: capabilitiesView, key: '4' },
  { id: 'device', label: 'This device', icon: 'device', group: 'CURI', view: device, key: '5' },
  { id: 'connections', label: 'Connections', icon: 'link', group: 'CURI', view: connections, key: '6' },
  { id: 'operations', label: 'Activity', icon: 'activity', group: 'System', view: tabbed(ACTIVITY_TABS, operations), key: '7' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'System', view: tabbed(SETTINGS_TABS, settings), key: '8' },
  { id: 'audit', hidden: true, parent: 'operations', label: 'Audit log', view: tabbed(ACTIVITY_TABS, audit) },
  { id: 'jobs', hidden: true, parent: 'operations', label: 'Searches and quotas', view: tabbed(ACTIVITY_TABS, jobs) },
  { id: 'automation', hidden: true, parent: 'settings', label: 'Autonomy', view: tabbed(SETTINGS_TABS, automation) },
  { id: 'bridge', hidden: true, parent: 'settings', label: 'Claude integration', view: tabbed(SETTINGS_TABS, bridge) },
  { id: 'security', hidden: true, parent: 'settings', label: 'Security', view: tabbed(SETTINGS_TABS, security) },
  { id: 'about', hidden: true, parent: 'settings', label: 'About', view: tabbed(SETTINGS_TABS, about) },
  { id: 'compare', hidden: true, parent: 'library', label: 'Compare', view: compareView },
  { id: 'resource', hidden: true, parent: 'library', label: 'Resource', view: resource },
  { id: 'integrations', hidden: true, parent: 'library', label: 'Quick integrations', view: integrations },
  { id: 'skills', hidden: true, parent: 'device', label: 'Skills', view: skills },
  { id: 'mcp', hidden: true, parent: 'device', label: 'MCP servers', view: mcp },
  { id: 'welcome', hidden: true, label: 'Boas-vindas', view: welcome },
  { id: 'wizard', hidden: true, label: 'Setup', view: wizard },
];
// Old addresses keep working.
const ALIASES = { dashboard: 'home', radar: 'discover', map: 'capabilities', machine: 'device' };
const byId = Object.fromEntries(ROUTES.map(r => [r.id, r]));

export const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
export function go(route) { location.hash = `#/${route}`; }

// ---------- compare tray (session) ----------
const trayIds = new Set(JSON.parse(sessionStorage.getItem('curi-compare') || '[]'));
const saveTray = () => { sessionStorage.setItem('curi-compare', JSON.stringify([...trayIds])); renderNavBadges(); };
export const compareTray = {
  get ids() { return trayIds; }, get size() { return trayIds.size; }, has: id => trayIds.has(id),
  add(id) { if (trayIds.size < 5) trayIds.add(id); else toast('You can compare up to 5 resources', 'bad'); saveTray(); },
  delete(id) { trayIds.delete(id); saveTray(); },
  toggle(id) { if (trayIds.has(id)) trayIds.delete(id); else if (trayIds.size < 5) trayIds.add(id); else toast('Up to 5 resources', 'bad'); saveTray(); },
  clear() { trayIds.clear(); saveTray(); },
};

// ---------- polling & jobs ----------
let pollTimer = null, jobListeners = [];
let engineDown = false;
function engineState(ok) {
  if (ok === !engineDown) return;
  engineDown = !ok;
  if (engineDown) toast('Lost connection to the CURI engine. Retrying…', 'bad', { timeout: 6000 }); else toast('Reconnected to the engine.', 'good');
}
export function setPoll(fn, ms) {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) Promise.resolve().then(fn).then(() => engineState(true), e => { if (e instanceof TypeError) engineState(false); }); }, ms);
}
export function onJobsChange(fn) { jobListeners.push(fn); }
const watching = new Map();
let watchTimer = null;
// Polls Core while a long job runs; on completion: refresh the view, toast, and notify if the app is in the background.
export function watchJob(name, doneMessage) {
  watching.set(name, doneMessage || 'Done');
  if (watchTimer) return;
  watchTimer = setInterval(async () => {
    let r;
    try { r = await api('running'); } catch { return; }
    for (const [job, msg] of [...watching]) if (!r.jobs.includes(job)) {
      watching.delete(job);
      toast(msg, 'good');
      if (document.hidden) api('notify', { title: 'CURI', body: msg }).catch(() => {});
      jobListeners.forEach(f => f());
    }
    if (r.jobs.length) jobListeners.forEach(f => f());
    if (!watching.size) { clearInterval(watchTimer); watchTimer = null; }
  }, 2500);
}

// ---------- shell ----------
function shell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main navigation' }, h('div', { class: 'nav-indicator', 'aria-hidden': 'true' }));
  let group = null, wrap;
  for (const r of ROUTES.filter(x => !x.hidden)) {
    if (r.group !== group) { group = r.group; wrap = h('div', { class: 'nav-group' }, group === 'CURI' ? null : h('span', { class: 'micro' }, group)); nav.append(wrap); }
    wrap.append(h('a', { href: `#/${r.id}`, 'data-route': r.id, title: r.key ? `${r.label} (⌘${r.key})` : r.label }, icon(r.icon), h('span', null, r.label), h('span', { class: 'badge-slot' })));
  }
  nav.addEventListener('click', e => { if (e.target.closest('a') && e.detail === 0) navByKeyboard = true; });
  document.body.prepend(h('div', { class: 'titlebar', 'data-tauri-drag-region': '' }));
  document.body.append(h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand', 'data-tauri-drag-region': '' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, brandMark({ small: true, size: 18 })), h('div', { class: 'brand-text' }, h('div', { class: 'brand-name' }, 'CURI'), h('div', { class: 'brand-sub' }, 'Capabilities for your agents'))),
      h('button', { type: 'button', class: 'search-trigger', onclick: () => openPalette(), 'aria-label': 'Open command palette' }, icon('search', 'sm'), h('span', null, 'Search or run…'), h('kbd', null, '⌘K')),
      nav,
      h('div', { class: 'sidebar-foot', id: 'side-foot' })),
    h('main', { id: 'main', tabindex: '-1' })));
}

function placeIndicator(animate) {
  const ind = document.querySelector('.nav-indicator');
  const a = document.querySelector('.nav a[aria-current="page"]');
  if (!ind) return;
  if (!a) { ind.style.opacity = '0'; return; }
  if (!animate) ind.style.transition = 'none';
  ind.style.opacity = '1';
  ind.style.transform = `translateY(${a.offsetTop}px)`;
  if (!animate) requestAnimationFrame(() => (ind.style.transition = ''));
}

function renderNavBadges() {
  const slot = document.querySelector('.nav a[data-route="library"] .badge-slot');
  if (slot) fill(slot, trayIds.size ? h('span', { class: 'badge info num' }, trayIds.size) : '');
}

async function footer() {
  try {
    const s = await api('status');
    document.getElementById('side-foot').replaceChildren(h('div', { class: 'row' }, status(s.bootstrap.state)), h('div', { class: 'row num' }, `${s.resources} resources · schema v${s.schema_version}`));
  } catch {}
}

// ---------- router ----------
let navByKeyboard = false, renderSeq = 0, firstRender = true;
export async function mount() {
  const seq = ++renderSeq;
  clearInterval(pollTimer); jobListeners = [];
  const main = document.getElementById('main');
  if (!TOKEN) { fill(main, h('div', { class: 'page' }, empty('lock', 'No session token', 'Open CURI from the app, or run "curi app" to get an authenticated link.'))); return; }
  const [path, arg] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  if (ALIASES[path]) { location.replace(`#/${ALIASES[path]}${location.hash.includes('?') ? `?${location.hash.split('?')[1]}` : ''}`); return; }
  const route = byId[path];
  if (!route) {
    const s = await api('bootstrapState').catch(() => ({ state: 'UNINITIALIZED' }));
    location.replace(`#/${['READY', 'PARTIAL_READY'].includes(s.state) ? 'home' : 'welcome'}`);
    return;
  }
  const active = route.parent || route.id;
  document.querySelectorAll('.nav a').forEach(a => { if (a.dataset.route === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  placeIndicator(!firstRender && !navByKeyboard && !reducedMotion());
  document.title = `${route.label} — CURI`;
  let page;
  // Slow views (live preflight, MCP health) get a skeleton; fast ones swap without a flash.
  const pending = setTimeout(() => { if (seq === renderSeq) fill(main, h('div', { class: 'page', 'aria-busy': 'true' }, h('div', { class: 'micro' }, route.label), h('div', { class: 'skel', style: { height: '28px', width: '240px', margin: '8px 0 28px' } }), skeleton(5, 56))); }, 150);
  try { page = await route.view(arg && decodeURIComponent(arg)); }
  catch (e) { page = h('div', { class: 'page' }, empty('alert', 'Couldn\'t load this page', e.message, h('button', { type: 'button', class: 'btn', onclick: () => mount() }, 'Try again'))); }
  clearTimeout(pending);
  if (seq !== renderSeq) return;
  const h1 = page.querySelector?.('h1');
  if (h1 && route.id === 'resource') document.title = `${h1.textContent} — CURI`;
  const swap = () => { fill(main, page); main.scrollTop = 0; };
  // Animated page swap only for pointer navigation; keyboard navigation is instant.
  if (document.startViewTransition && !navByKeyboard && !firstRender && !reducedMotion() && currentMotion() === 'full') {
    // A newer navigation skips the running transition; that rejection is expected, not an error.
    const t = document.startViewTransition(swap);
    for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => {});
  } else swap();
  navByKeyboard = false; firstRender = false;
  main.focus({ preventScroll: true });
  footer();
  renderNavBadges();
}
window.addEventListener('hashchange', mount);

// ---------- command palette (no open/close animation: used many times a day) ----------
function openPalette() {
  if (document.querySelector('.palette')) return;
  const input = h('input', { type: 'text', placeholder: 'Search resources, sections and actions…', 'aria-label': 'Command palette', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'p-list', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'p-list', id: 'p-list', role: 'listbox' });
  const scrim = h('div', { class: 'scrim instant' });
  const node = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, h('div', { class: 'p-input' }, icon('search'), input, h('kbd', null, 'esc')), list,
    h('div', { class: 'p-foot' }, h('span', null, h('kbd', null, '↑↓'), ' navigate'), h('span', null, h('kbd', null, '↵'), ' open'), h('span', null, h('kbd', null, 'esc'), ' close')));
  const prev = document.activeElement;
  const close = () => { scrim.remove(); node.remove(); prev?.focus?.(); };
  scrim.addEventListener('mousedown', close);
  const actions = [
    { label: 'Search GitHub', icon: 'radar', run: () => go('discover') },
    { label: 'Compare selected', icon: 'compare', run: () => go('compare') },
    { label: 'MCP servers', icon: 'mcp', run: () => go('mcp') },
    { label: 'Installed skills', icon: 'skills', run: () => go('skills') },
    { label: 'Quick integrations (pinned MCP)', icon: 'plus', run: () => go('integrations') },
    { label: 'Run independent verification', icon: 'shield', run: () => go('bridge') },
    { label: 'Run maintenance now', icon: 'bolt', run: async () => { const r = await api('maintenanceRun'); toast(`${r.queued.length} task(s) started; ${r.suggestions.length} waiting for permission`, 'good'); } },
    { label: 'Connect Claude Code', icon: 'bridge', run: () => go('connections') },
    { label: 'Pending operations', icon: 'activity', run: () => go('operations?status=awaiting_approval') },
    { label: 'Revoke autonomy', icon: 'lock', run: async () => { await api('policyRevoke'); toast('Autonomy revoked', 'good'); } },
    { label: 'Add a URL to the catalogue', icon: 'plus', run: () => window.__curiMenu('add-url-dialog') },
    { label: 'Export registry', icon: 'download', run: () => withProgress('A exportar o registo', () => api('exportFile').then(r => `${r.count} resources exported to ${r.file}`)) },
    { label: 'Detect what\'s installed', icon: 'refresh', run: () => go('device') },
    { label: 'Toggle light/dark theme', icon: 'sparkle', run: () => applyTheme(matchMedia('(prefers-color-scheme: dark)').matches ? (currentTheme() === 'light' ? 'system' : 'light') : (currentTheme() === 'dark' ? 'system' : 'dark')) },
  ];
  let items = [], sel = 0, seq = 0;
  const render = async () => {
    const term = input.value.trim().toLowerCase();
    const my = ++seq;
    const nav = ROUTES.filter(r => !r.hidden && (!term || r.label.toLowerCase().includes(term))).map(r => ({ section: 'Sections', label: r.label, icon: r.icon, hint: r.key ? `⌘${r.key}` : '', run: () => go(r.id) }));
    const acts = actions.filter(a => !term || a.label.toLowerCase().includes(term)).map(a => ({ ...a, section: 'Actions' }));
    let res = [];
    if (term.length >= 2) {
      try { res = (await api('search', { query: term, limit: 8 })).results.map(r => ({ section: 'Resources', label: r.name, icon: TYPE_ICON[r.type] || 'info', hint: r.type, run: () => go(`resource/${encodeURIComponent(r.id)}`) })); } catch {}
      if (my !== seq) return;
    }
    items = term ? [...res, ...nav, ...acts] : [...nav, ...acts];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let lastSec = null;
    fill(list, ...(items.length ? items.flatMap((it, i) => {
      const out = [];
      if (it.section !== lastSec) { lastSec = it.section; out.push(h('div', { class: 'p-sec micro' }, it.section)); }
      const el = h('div', { class: 'p-item', role: 'option', id: `p-${i}`, 'aria-selected': String(i === sel) }, icon(it.icon), h('span', null, it.label), it.hint ? h('span', { class: 'p-hint' }, it.hint) : null);
      el.addEventListener('mousemove', () => { if (sel !== i) { sel = i; highlight(); } });
      el.addEventListener('click', () => choose(i));
      out.push(el);
      return out;
    }) : [h('div', { class: 'empty' }, h('p', null, 'No local results.'), h('button', { type: 'button', class: 'btn', onclick: () => { close(); go(`radar?intent=${encodeURIComponent(input.value)}`); } }, icon('radar', 'sm'), 'Search GitHub'))]));
    input.setAttribute('aria-activedescendant', `p-${sel}`);
  };
  const highlight = () => { list.querySelectorAll('.p-item').forEach(el => el.setAttribute('aria-selected', String(el.id === `p-${sel}`))); input.setAttribute('aria-activedescendant', `p-${sel}`); list.querySelector(`#p-${sel}`)?.scrollIntoView({ block: 'nearest' }); };
  const choose = async i => { const it = items[i]; if (!it) return; close(); navByKeyboard = true; try { await it.run(); } catch (e) { toast(e.message, 'bad'); } };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); sel = 0; t = setTimeout(render, 90); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.body.append(scrim, node);
  input.focus();
  render();
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.matches?.('input, textarea, select, [contenteditable]');
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (mod && e.key === ',') { e.preventDefault(); navByKeyboard = true; go('settings'); return; }
  if (mod && /^[1-9]$/.test(e.key)) { const r = ROUTES.find(x => x.key === e.key); if (r) { e.preventDefault(); navByKeyboard = true; go(r.id); } return; }
  if (!typing && e.key === '/') { const s = document.getElementById('page-search'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
});

// ---------- native menu bridge (called by the Tauri shell via eval) ----------
window.__curiMenu = cmd => {
  if (cmd === 'palette') return openPalette();
  if (cmd === 'reload') return mount();
  if (cmd === 'add-url' || cmd === 'add-url-dialog') return addUrlDialog();
  if (cmd.startsWith('route:')) { navByKeyboard = true; return go(cmd.slice(6)); }
};

async function addUrlDialog() {
  const url = await promptDialog({ title: 'Add to catalogue', body: 'Paste a GitHub repository or website URL. CURI classifies it and inspects what it publishes; nothing gets installed.', placeholder: 'https://github.com/owner/project', confirm: 'Add' });
  if (!url) return;
  try {
    const r = await api('add', { url: url.trim() });
    toast(r.duplicate ? `Already in the catalogue: ${r.name}` : `Added: ${r.name}`, 'good');
    if (!r.duplicate) api('opEnqueue', { kind: 'resource.inspect', params: { id: r.id }, approved: true }).catch(() => {});
    go(`resource/${encodeURIComponent(r.id)}`);
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------- drag & drop a URL anywhere to catalogue it ----------
let dropEl = null, dragDepth = 0;
const urlFrom = dt => (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n').map(s => s.trim()).find(s => /^https?:\/\//i.test(s));
window.addEventListener('dragenter', e => {
  if (![...(e.dataTransfer?.types || [])].some(t => t === 'text/uri-list' || t === 'text/plain')) return;
  dragDepth++;
  dropEl ||= document.body.appendChild(h('div', { class: 'dropzone', role: 'status' }, h('div', null, h('div', { class: 'glyph' }, icon('plus', 'lg')), h('strong', null, 'Drop to add to the catalogue'), h('p', { class: 'muted' }, 'The URL is normalised and classified; it\'s never installed.'))));
});
window.addEventListener('dragover', e => { if (dropEl) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0 && dropEl) { dropEl.remove(); dropEl = null; dragDepth = 0; } });
window.addEventListener('drop', async e => {
  if (!dropEl) return;
  e.preventDefault(); dropEl.remove(); dropEl = null; dragDepth = 0;
  const url = urlFrom(e.dataTransfer);
  if (!url) { toast('Only http(s) URLs can be added.', 'bad'); return; }
  try { const r = await api('add', { url }); toast(r.duplicate ? `Already in the catalogue: ${r.name}` : `Added: ${r.name} (${r.status})`, 'good'); go(`resource/${encodeURIComponent(r.id)}`); } catch (err) { toast(err.message, 'bad'); }
});

// Desktop app: no browser page menu, except over editable or selectable text.
document.addEventListener('contextmenu', e => { if (!e.defaultPrevented && !e.target.closest('input, textarea, .selectable, pre, .mono')) e.preventDefault(); });

shell();
mount();
startWatcher();
window.addEventListener('resize', () => placeIndicator(false));
