// The pieces the Library tabs and Capabilities share, so moving between them doesn't reshuffle the page:
// the top line (section name, actions, tabs), a two-line headline, the big search capsule, the
// generated "app icon" for a resource, and the resource card.
import { h, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { btn } from '../lib/ui.js';
import { go } from '../app.js';

export const KIND_GLYPH = { plugin: 'layers', 'skill-pack': 'skills', skill: 'skills', mcp: 'mcp', cli: 'terminal', app: 'grid', library: 'library', components: 'box', framework: 'library', reference: 'info' };

export function hero({ eyebrow, title, em, sub, actions = [], search = null, after = null }) {
  return h('header', { class: 'cat-hero' },
    h('div', { class: 'cat-top' }, h('span', { class: 'cat-eyebrow' }, eyebrow), h('div', { class: 'actions' }, actions)),
    h('h1', null, title, em ? h('em', null, em) : null),
    sub ? h('p', null, sub) : null,
    search, after);
}

export const searchCapsule = (...children) => h('div', { class: 'cat-search' }, icon('search'), ...children);

// Every resource gets its own colour, stable across sessions: an app icon without a logo to borrow.
export function hue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
export function art(key, kind, size = '') {
  const t = h('span', { class: `art ${size}`, 'aria-hidden': 'true' }, icon(KIND_GLYPH[kind] || 'box'));
  t.style.setProperty('--h', hue(key));
  return t;
}

const SHORT = { installed: 'Installed', configured: 'Connected', account: 'On claude.ai' };

// A resource as a card: icon, name, kind, what it does, and the one action that fits. Clicking the card
// opens its page.
export function resourceCard(r, { action, extra } = {}) {
  const open = () => go(`resource/${encodeURIComponent(r.id)}`);
  const el = h('article', { class: `gcard ${r.state ? 'mine' : ''}`, tabindex: '0', role: 'listitem', 'aria-label': `${r.name}, ${r.kind_label || ''}` },
    h('div', { class: 'g-top' }, art(r.id, r.kind), h('div', { class: 'g-id' }, h('strong', null, r.name), h('span', null, r.kind_label || ''))),
    h('p', null, r.description || ''),
    extra || null,
    h('div', { class: 'g-foot' },
      h('div', { class: 'g-meta' }, r.stars != null ? h('span', null, icon('star', 'sm'), compact(r.stars)) : null, r.pushed_at && !r.state ? h('span', null, relTime(r.pushed_at)) : null),
      r.state ? h('span', { class: `state ${r.state}` }, SHORT[r.state] || r.state) : null,
      action || (r.state ? btn('Open', open, { size: 'sm', kind: 'pill' }) : null)));
  el.addEventListener('click', e => { if (!e.target.closest('button, a')) open(); });
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } });
  return el;
}
