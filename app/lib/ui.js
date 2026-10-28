// Reusable UI primitives. Every component here is wired to real behaviour by its caller.
import { h, fmtDate, fill } from './dom.js';
import { icon } from './icons.js';

// ---------- API ----------
const m = location.hash.match(/token=([a-f0-9]{32,})/);
// The native shell's ?native=1 must survive the token being removed from the address.
if (new URLSearchParams(location.search).get('native') === '1') sessionStorage.setItem('curi-native', '1');
if (m) { sessionStorage.setItem('curi-token', m[1]); history.replaceState(null, '', location.pathname + '#/'); }
export const TOKEN = sessionStorage.getItem('curi-token');

export async function api(action, params = {}) {
  const res = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(params) });
  let j;
  try { j = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
  if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j.data;
}

// ---------- Buttons ----------
// Async-aware: blurs its label and shows a spinner while the action runs (no layout shift).
export function btn(label, onclick, { kind = '', iconName, title, disabled, size } = {}) {
  const content = h('span', { class: 'btn-content' }, iconName ? icon(iconName, 'sm') : null, label);
  const b = h('button', { type: 'button', class: `btn ${kind} ${size || ''} ${label ? '' : 'icon'}`.trim(), title, 'aria-label': title || null, disabled: disabled || null }, content);
  if (onclick) b.addEventListener('click', async e => {
    if (b.classList.contains('busy')) return;
    b.classList.add('busy'); b.setAttribute('aria-busy', 'true');
    try { await onclick(e); } catch (err) { if (!err.shown) toast(err.message, 'bad'); } finally { b.classList.remove('busy'); b.removeAttribute('aria-busy'); }
  });
  return b;
}

export const linkBtn = (label, href, { kind = '', iconName } = {}) => h('a', { class: `btn ${kind}`, href }, h('span', { class: 'btn-content' }, iconName ? icon(iconName, 'sm') : null, label));

// ---------- Status language ----------
const STATUS = {
  READY: ['good', 'check', 'Ready'], PARTIAL_READY: ['warn', 'alert', 'Partial'], FAILED: ['bad', 'x', 'Failed'], BLOCKED: ['bad', 'lock', 'Blocked'],
  UNINITIALIZED: ['', 'clock', 'Not set up'], APPROVAL_REQUIRED: ['info', 'shield', 'Awaiting approval'], PROVISIONING: ['info', 'bolt', 'A aplicar'], VERIFYING: ['info', 'check', 'Verifying'],
  PAUSED: ['warn', 'pause', 'Paused'], CANCELLED: ['', 'x', 'Cancelled'], ROLLING_BACK: ['warn', 'undo', 'A reverter'], RECOVERING: ['warn', 'refresh', 'A recuperar'],
  ENVIRONMENT_AUDITED: ['info', 'check', 'Environment audited'], PLAN_READY: ['info', 'wizard', 'Plan ready'], PREFLIGHT: ['info', 'clock', 'Preflight'],
  INSTALLED: ['good', 'check', 'Installed'], CONFIGURED: ['good', 'check', 'Configured'], CATALOGUED: ['', 'library', 'Catalogued'], ON_DEMAND: ['info', 'bolt', 'On demand'],
  NEEDS_VERIFICATION: ['warn', 'clock', 'Needs verification'], PENDING_REVIEW: ['warn', 'clock', 'Pending review'], UNAVAILABLE: ['bad', 'x', 'Unavailable'], DEPRECATED: ['bad', 'alert', 'Deprecated'],
  REJECTED: ['bad', 'x', 'Rejected'], UNSUPPORTED: ['bad', 'x', 'Unsupported'], REQUIRES_AUTHENTICATION: ['warn', 'lock', 'Needs sign-in'], REQUIRES_APPROVAL: ['warn', 'shield', 'Needs approval'],
  pass: ['good', 'check', 'Passed'], fail: ['bad', 'x', 'Failed'], blocked: ['warn', 'lock', 'Blocked'],
  'files-ok': ['good', 'check', 'Files OK'], configured: ['good', 'check', 'Configured'], drift: ['bad', 'alert', 'Drift'], outdated: ['warn', 'refresh', 'Outdated'],
  committed: ['good', 'check', 'Applied'], rolled_back: ['', 'undo', 'Rolled back'], rollback_partial: ['warn', 'alert', 'Partial rollback'], pending: ['info', 'clock', 'Pending'], failed: ['bad', 'x', 'Failed'],
  completed: ['good', 'check', 'Done'], partial: ['warn', 'alert', 'Partial'], running: ['info', 'clock', 'Running'],
  candidate: ['info', 'sparkle', 'Candidate'], promoted: ['good', 'check', 'Catalogued'], rejected: ['bad', 'x', 'Rejected'],
  approved: ['good', 'check', 'Approved'], missing: ['warn', 'alert', 'Missing'], ok: ['good', 'check', 'OK'], rate_limited: ['warn', 'clock', 'Rate limited'], unreachable: ['bad', 'x', 'Unreachable'], error: ['bad', 'x', 'Error'],
  strong: ['good', 'check', 'Strong coverage'], weak: ['warn', 'alert', 'Weak coverage'], none: ['bad', 'x', 'No coverage'],
};
export function status(key, labelOverride) {
  const [kind, ic, label] = STATUS[key] || ['', 'info', key];
  return h('span', { class: `badge ${kind}`, title: key }, icon(ic), labelOverride || label);
}
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const dot = (kind = '') => h('span', { class: `dot ${kind}`, 'aria-hidden': 'true' });

// ---------- Layout pieces ----------
export function panel({ title, meta, actions, flush, cls = '', id } = {}, ...body) {
  return h('section', { class: `panel ${cls}`, id, 'aria-label': title || null },
    title || actions || meta ? h('header', { class: 'panel-head' }, title ? h('h2', null, title) : null, meta ? h('span', { class: 'micro' }, meta) : null, actions ? h('div', { class: 'row', style: { marginLeft: meta ? '12px' : 'auto' } }, actions) : null) : null,
    h('div', { class: `panel-body ${flush ? 'flush' : ''}` }, ...body));
}

// Headings carry their own weight: no eyebrow labels above them (the parameter is accepted and ignored).
export function pageHead({ title, sub, actions }) {
  return h('header', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), actions ? h('div', { class: 'actions' }, actions) : null);
}

export function empty(iconName, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'glyph' }, icon(iconName, 'lg')), h('h4', null, title), text ? h('p', null, text) : null, actions.length ? h('div', { class: 'row', style: { justifyContent: 'center' } }, actions) : null);
}

export function notice(kind, text, iconName) {
  return h('div', { class: `notice ${kind}`, role: kind === 'bad' ? 'alert' : null }, icon(iconName || (kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'info'), 'sm'), h('div', null, text));
}

export function skeleton(rows = 4, height = 18) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'A carregar' }, Array.from({ length: rows }, (_, i) => h('div', { class: 'skel', style: { height: `${height}px`, width: `${90 - i * 9}%` } })));
}

export function table(cols, rows, { onRow, emptyText = 'Nothing yet.', label } = {}) {
  if (!rows.length) return empty('list', emptyText);
  return h('div', { class: 'table-wrap' }, h('table', { class: 't', 'aria-label': label || null },
    h('thead', null, h('tr', null, cols.map(c => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.label)))),
    h('tbody', null, rows.map(r => {
      const tr = h('tr', { class: onRow ? 'click' : null, tabindex: onRow ? '0' : null }, cols.map(c => h('td', { class: c.num ? 'num' : null }, c.cell(r))));
      if (onRow) { tr.addEventListener('click', () => onRow(r)); tr.addEventListener('keydown', e => e.key === 'Enter' && onRow(r)); }
      return tr;
    }))));
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));
}

export function meter(ratio, kind = '', label) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  const i = h('i', { style: { transform: `scaleX(${r})` } });
  return h('div', { class: `meter ${kind}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r * 100)), 'aria-label': label || null }, i);
}

export function toggle(id, checked, label, hint) {
  const input = h('input', { type: 'checkbox', id, checked: checked || null, role: 'switch' });
  return { input, el: h('label', { class: 'rows-label row', for: id, style: { gap: '12px', flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('span', { class: 'switch' }, input, h('span')), h('span', { class: 'grow' }, h('div', { class: 't1' }, label), hint ? h('div', { class: 't2' }, hint) : null)) };
}

export function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const render = v => fill(wrap, ...options.map(([val, text, ic, aria]) => h('button', { type: 'button', 'aria-pressed': String(val === v), 'aria-label': aria || null, title: aria || null, onclick: () => { render(val); onChange(val); } }, ic ? icon(ic, 'sm') : null, text)));
  render(value);
  return wrap;
}

// ---------- Overlays ----------
let toastRoot;
export function toast(message, kind = 'info', { timeout } = {}) {
  toastRoot ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${kind}` }, icon(kind === 'good' ? 'check' : kind === 'bad' ? 'alert' : 'info'), h('div', { class: 'selectable' }, message));
  toastRoot.append(t);
  let timer;
  const close = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 180); };
  const arm = () => { timer = setTimeout(close, timeout ?? (kind === 'bad' ? 7000 : 3800)); };
  // Sonner principle: pause the timer while hovered or while the window is hidden.
  t.addEventListener('mouseenter', () => clearTimeout(timer)); t.addEventListener('mouseleave', arm);
  if (document.hidden) document.addEventListener('visibilitychange', arm, { once: true }); else arm();
  return close;
}

export function overlay(node, { onClose } = {}) {
  const prev = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const close = () => { scrim.remove(); node.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); onClose?.(); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { // focus trap
      const f = [...node.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  scrim.addEventListener('mousedown', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim, node);
  return close;
}

// Native-feeling sheets replacing window.confirm/prompt (which a desktop webview may not implement).
export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); close(); } };
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}` }, confirm);
    const lines = Array.isArray(body) ? body : String(body || '').split('\n').filter(Boolean);
    const node = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' }, h('h3', { id: 'dlg-t' }, title), lines.length ? h('div', { class: 'dlg-body' }, lines.map(l => h('p', null, l))) : null,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(false) }, 'Cancel'), ok));
    ok.addEventListener('click', () => finish(true));
    const close = overlay(node, { onClose: () => finish(false) });
    ok.focus();
  });
}

export function promptDialog({ title, body, placeholder = '', confirm = 'OK', value = '' }) {
  return new Promise(resolve => {
    let done = false;
    const input = h('input', { type: 'text', placeholder, value, 'aria-label': title });
    const finish = v => { if (!done) { done = true; resolve(v); close(); } };
    const node = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' }, h('h3', { id: 'dlg-t' }, title), body ? h('p', null, body) : null, h('div', { class: 'field' }, input),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'), h('button', { type: 'button', class: 'btn primary', onclick: () => finish(input.value) }, confirm)));
    input.addEventListener('keydown', e => e.key === 'Enter' && finish(input.value));
    const close = overlay(node, { onClose: () => finish(null) });
    input.focus();
  });
}

let openMenu;
export function contextMenu(x, y, items) {
  openMenu?.();
  const node = h('div', { class: 'menu', role: 'menu' }, items.map(it => it === '-' ? h('hr') : h('button', { type: 'button', role: 'menuitem', onclick: async () => { close(); try { await it.run(); } catch (e) { toast(e.message, 'bad'); } } }, icon(it.icon || 'chevron', 'sm'), it.label)));
  document.body.append(node);
  const r = node.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 8), top = Math.min(y, innerHeight - r.height - 8);
  Object.assign(node.style, { left: `${left}px`, top: `${top}px` });
  node.style.setProperty('--origin', `${x - left}px ${y - top}px`);
  const onDoc = e => { if (!node.contains(e.target)) close(); };
  const onKey = e => {
    const items = [...node.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  };
  function close() { node.remove(); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true); openMenu = null; }
  setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey, true); });
  node.querySelector('button')?.focus();
  openMenu = close;
  return close;
}

// Tooltip: delayed first show, instant for subsequent hovers within 600ms.
let tipEl, tipTimer, lastTipHide = 0;
export function tooltip(target, contentFn) {
  const show = e => {
    const run = () => {
      tipEl ||= document.body.appendChild(h('div', { class: 'tip', role: 'tooltip' }));
      fill(tipEl, ...[].concat(contentFn()));
      tipEl.hidden = false;
      place(e);
    };
    clearTimeout(tipTimer);
    if (Date.now() - lastTipHide < 600) run(); else tipTimer = setTimeout(run, 280);
  };
  const place = e => {
    if (!tipEl || tipEl.hidden) return;
    const r = tipEl.getBoundingClientRect();
    const x = e.clientX ?? target.getBoundingClientRect().left, y = e.clientY ?? target.getBoundingClientRect().top;
    tipEl.style.left = `${Math.min(x + 14, innerWidth - r.width - 8)}px`;
    tipEl.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  const hide = () => { clearTimeout(tipTimer); if (tipEl && !tipEl.hidden) { tipEl.hidden = true; lastTipHide = Date.now(); } };
  target.addEventListener('pointerenter', show); target.addEventListener('pointermove', place); target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', show); target.addEventListener('blur', hide);
}

export function externalLink(url, text) {
  let ok = false;
  try { ok = /^https?:$/.test(new URL(url).protocol); } catch {}
  if (!ok) return h('span', { class: 'mono' }, url);
  const a = h('a', { href: url, class: 'ext', rel: 'noopener noreferrer', title: url }, text || url, ' ', icon('external', 'sm'));
  a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); api('openExternal', { url }).catch(err => toast(err.message, 'bad')); });
  return a;
}

export const when = iso => h('span', { class: 'num', title: fmtDate(iso, { dateStyle: 'full', timeStyle: 'medium' }) }, fmtDate(iso));
