// Kits: a few resources that work well together for one kind of job (web testing, video, security…).
// A kit installs every member that isn't here yet, one visible operation at a time, and skips what
// CURI can't install on this computer instead of failing halfway.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, toast } from '../lib/ui.js';
import { go, mount } from '../app.js';
import { hue, resourceCard } from './hero.js';
import { quickAction, quickLabel } from './library.js';

const HERE = ['installed', 'configured', 'account'];

function kitArt(k, size = '') {
  const t = h('span', { class: `art ${size}`, 'aria-hidden': 'true' }, icon(k.glyph || 'layers'));
  t.style.setProperty('--h', hue(`kit:${k.id}`));
  return t;
}

const members = (k, lib) => k.resources.map(id => lib.find(r => r.id === id)).filter(Boolean);
const missing = list => list.filter(r => !HERE.includes(r.state) && r.installable);

export async function installKit(k, list, after = () => mount()) {
  const todo = missing(list);
  if (!todo.length) { toast(`Everything in ${k.name} that CURI can install is already here.`); return; }
  for (const r of todo) await quickAction(r, () => {});
  after();
}

export function kitCard(k, lib) {
  const list = members(k, lib);
  const here = list.filter(r => HERE.includes(r.state)).length, todo = missing(list).length;
  const open = () => go(`kit/${k.id}`);
  const el = h('article', { class: 'gcard kitcard', tabindex: '0', role: 'listitem', 'aria-label': `${k.name} kit` },
    h('div', { class: 'g-top' }, kitArt(k), h('div', { class: 'g-id' }, h('strong', null, k.name), h('span', null, `Kit · ${list.length} tools`))),
    h('p', null, k.can),
    h('div', { class: 'kit-members' }, list.map(r => h('span', { class: HERE.includes(r.state) ? 'on' : '' }, r.name))),
    h('div', { class: 'g-foot' },
      h('div', { class: 'g-meta' }, h('span', null, `${here} of ${list.length} here`)),
      todo ? btn(`Get ${todo}`, () => installKit(k, list), { size: 'sm', kind: 'pill get', iconName: 'download', title: `Install the ${todo} missing` }) : h('span', { class: 'state installed' }, 'All here')));
  el.addEventListener('click', e => { if (!e.target.closest('button, a')) open(); });
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } });
  return el;
}

export async function kitView(id) {
  const [kits, lib] = await Promise.all([api('kits'), api('library')]);
  const k = kits.find(x => x.id === id);
  if (!k) return h('div', { class: 'page' }, empty('alert', 'Kit not found', id, btn('Back to the catalogue', () => go('library'), { kind: 'primary' })));
  const list = members(k, lib);
  const todo = missing(list), here = list.filter(r => HERE.includes(r.state));
  const skipped = list.filter(r => !HERE.includes(r.state) && !r.installable);
  return h('div', { class: 'page' },
    h('header', { class: 'sheet-head' }, kitArt(k, 'lg'),
      h('div', null, h('h1', null, k.name), h('div', { class: 'sub' }, h('span', null, 'Kit'), h('span', null, `${list.length} tools`), h('span', { class: `state ${todo.length ? 'available' : 'installed'}` }, `${here.length} of ${list.length} here`)))),
    h('div', { class: 'actionbar' },
      todo.length ? btn(`Install the ${todo.length} missing`, () => installKit(k, list), { kind: 'primary', iconName: 'download' }) : h('span', { class: 'lead' }, 'Everything in this kit that CURI can install is here.'),
      h('span', { class: 'grow' }),
      skipped.length ? h('span', { class: 'muted small' }, `${skipped.map(r => r.name).join(', ')}: install by hand`) : null),
    h('p', { class: 'prose cap-can' }, k.can),
    h('div', { class: 'cat-grid', role: 'list' }, list.map(r => resourceCard(r, {
      action: !HERE.includes(r.state) && r.installable ? btn(quickLabel(r)[0], () => quickAction(r, () => mount()), { size: 'sm', kind: 'pill get', iconName: 'download' }) : null }))));
}
