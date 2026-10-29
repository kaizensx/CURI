// Capabilities: what the agents on this device can do, what one action away would add, and what only
// exists as project libraries. Laid out like the Library (same header, same cards) so moving between them
// doesn't feel like another app. Every capability opens its own page with everything that provides it.
import { h, s, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toggle, empty } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runAction } from './common.js';
import { hero, hue, resourceCard } from './hero.js';

const STATUS = { ready: ['installed', 'Available'], 'one-step': ['available', 'One step away'], project: ['project', 'In projects'], reference: ['reference', 'Reference only'], gap: ['reference', 'Missing'] };
const ORDER = { ready: 0, 'one-step': 1, project: 2, reference: 3, gap: 4 };
const AREA_GLYPH = { agents: 'agent', web: 'compass', engineering: 'terminal', quality: 'check', security: 'shield', re: 'search', data: 'copy', '3d': 'box', video: 'play', audio: 'activity', hardware: 'device', science: 'sparkle', ai: 'bolt', frontend: 'grid', design: 'sparkle', motion: 'play', graphics: 'layers', backend: 'database', mobile: 'device', desktop: 'grid', automation: 'refresh', ops: 'activity', discovery: 'radar', business: 'star' };

// Small progress ring: green = available, blue = one step away.
function ring(ready, step, total) {
  const r = 15, c = 2 * Math.PI * r, a = total ? ready / total : 0, b = total ? step / total : 0;
  return s('svg', { class: 'ring', viewBox: '0 0 40 40', 'aria-hidden': 'true' },
    s('circle', { cx: 20, cy: 20, r, class: 'ring-bg' }),
    b ? s('circle', { cx: 20, cy: 20, r, class: 'ring-step', 'stroke-dasharray': `${(c * b).toFixed(1)} ${c}`, 'stroke-dashoffset': (-c * a).toFixed(1) }) : null,
    a ? s('circle', { cx: 20, cy: 20, r, class: 'ring-ready', 'stroke-dasharray': `${(c * a).toFixed(1)} ${c}` }) : null);
}

function areaArt(domain, size = '') {
  const t = h('span', { class: `art ${size}`, 'aria-hidden': 'true' }, icon(AREA_GLYPH[domain] || 'box'));
  t.style.setProperty('--h', hue(domain));
  return t;
}

// Install the best provider of a capability in one go, or open its page when that needs a choice.
async function getVia(res, after = () => location.reload()) {
  const v = await api('resourceView', { id: res.id });
  const a = v.actions.primary || v.actions.install.find(x => !x.disabled && !x.shared);
  if (!a) { go(`resource/${encodeURIComponent(res.id)}`); return; }
  await runAction(a, res.name, after);
}

// Ready / one step / missing as one bar, so the whole picture reads at a glance.
function meter(sm) {
  const total = sm.agent_total || 1, gap = Math.max(0, sm.agent_total - sm.agent_ready - sm.agent_one_step);
  const seg = (cls, n) => n ? h('span', { class: cls, style: { flexGrow: n } }) : null;
  return h('div', { class: 'cap-meter' },
    h('div', { class: 'bar', role: 'img', 'aria-label': `${sm.agent_ready} available, ${sm.agent_one_step} one step away, ${gap} missing, of ${total}` }, seg('ready', sm.agent_ready), seg('step', sm.agent_one_step), seg('gap', gap)),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'ready' }), h('b', null, sm.agent_ready), ' available'),
      h('span', null, h('i', { class: 'step' }), h('b', null, sm.agent_one_step), ' one step away'),
      h('span', null, h('i', { class: 'gap' }), h('b', null, gap), ' missing')));
}

export async function capabilitiesView() {
  const p = params();
  const m = await api('capabilityMap');
  // Old links (#/capabilities?focus=x) go straight to that capability's page.
  if (p.get('focus')) { location.replace(`#/capability/${encodeURIComponent(p.get('focus'))}`); return h('div'); }
  const st = { domain: p.get('domain') || '', agentOnly: p.get('all') !== '1', status: '' };
  const body = h('div', { class: 'capsections' });
  const strip = h('div', { class: 'capstrip', role: 'group', 'aria-label': 'Areas' });

  const card = c => {
    const [cls, label] = STATUS[c.status];
    const open = () => go(`capability/${encodeURIComponent(c.id)}`);
    const present = new Set(c.present);
    const el = h('article', { class: `gcard capcard ${c.status}`, tabindex: '0', role: 'listitem', 'aria-label': `${c.label}, ${label}` },
      h('div', { class: 'cc-top' }, h('span', { class: `state ${cls}` }, label), h('span', { class: 'cc-n' }, c.counts.total ? `${c.counts.total} option${c.counts.total === 1 ? '' : 's'}` : '')),
      h('strong', null, c.label),
      h('p', null, c.can),
      h('div', { class: 'g-foot' },
        h('div', { class: 'cc-prov' }, c.providers.slice(0, 3).map(pv => h('span', { class: present.has(pv.id) ? 'on' : '', title: pv.kind_label }, pv.name))),
        c.status === 'one-step' && c.recommended ? btn('Get', () => getVia(c.recommended), { size: 'sm', kind: 'pill get', iconName: 'download', title: `Install ${c.recommended.name}` })
          : c.status === 'gap' || c.status === 'reference' ? btn('Find', () => go(`library?tab=new&intent=${encodeURIComponent(c.label)}`), { size: 'sm', kind: 'pill', iconName: 'radar', title: 'Look for one on GitHub' }) : null));
    el.addEventListener('click', e => { if (!e.target.closest('button, a')) open(); });
    el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } });
    return el;
  };
  const render = () => {
    const caps = m.capabilities.filter(c => (!st.agentOnly || c.mode === 'agent') && (!st.status || c.status === st.status));
    fill(strip, m.domains.map(d => {
      const list = m.capabilities.filter(c => c.domain === d.id && (!st.agentOnly || c.mode === 'agent'));
      if (!list.length) return null;
      const ready = list.filter(c => c.status === 'ready').length, step = list.filter(c => c.status === 'one-step').length;
      const b = h('button', { type: 'button', class: 'capchip-area', 'aria-pressed': String(st.domain === d.id), title: d.sub }, ring(ready, step, list.length), h('span', { class: 'l' }, d.label), h('span', { class: 'n' }, `${ready}/${list.length}`));
      b.addEventListener('click', () => { st.domain = st.domain === d.id ? '' : d.id; render(); });
      return b;
    }));
    const secs = m.domains.filter(d => !st.domain || d.id === st.domain).map(d => {
      const list = caps.filter(c => c.domain === d.id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.label.localeCompare(b.label));
      if (!list.length) return null;
      const ready = list.filter(c => c.status === 'ready').length, step = list.filter(c => c.status === 'one-step').length;
      return h('section', { class: 'capgroup' },
        h('header', null, areaArt(d.id, 'sm'), h('div', null, h('h2', null, d.label), h('span', null, d.sub)), h('span', { class: 'count' }, `${ready} of ${list.length} available${step ? ` · ${step} one step away` : ''}`)),
        h('div', { class: 'cat-grid cap-grid', role: 'list' }, list.map(card)));
    }).filter(Boolean);
    fill(body, secs.length ? secs : empty('map', 'Nothing matches', 'Try another area or status.'));
  };
  const onlyAgent = toggle('agent-only', st.agentOnly, 'Only what the agent uses directly');
  onlyAgent.input.addEventListener('change', e => { st.agentOnly = e.target.checked; render(); });
  const statusTabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Status' }, [['', 'All'], ['ready', 'Available'], ['one-step', 'One step away'], ['gap', 'Missing']].map(([v, l]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(st.status === v) }, l);
    b.addEventListener('click', () => { st.status = v; statusTabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); });
    return b;
  }));
  render();
  const sm = m.summary;
  return h('div', { class: 'page cat' },
    hero({ eyebrow: 'Capabilities', title: 'What your agents ', em: 'can do.',
      sub: `${sm.agent_ready} of ${sm.agent_total} agent capabilities already work on this computer. ${sm.agent_one_step} more are one install away. The list grows as CURI finds new projects.`,
      after: meter(sm) }),
    m.recommendations.length ? h('section', { class: 'shelf' },
      h('header', null, h('div', null, h('h2', null, 'The steps that add the most'), h('p', null, 'Missing agent capabilities that one install fixes.'))),
      h('div', { class: 'cat-grid', role: 'list' }, m.recommendations.slice(0, 3).map(r => resourceCard({ ...r.resource, description: `Adds ${r.label.toLowerCase()}: ${r.can}` },
        { action: btn('Get', () => getVia(r.resource), { size: 'sm', kind: 'pill get', iconName: 'download' }) })))) : null,
    h('div', { class: 'cat-bar' }, h('div', { class: 'cat-bar-in' }, h('div', { class: 'cap-tools' }, statusTabs, onlyAgent.el), strip)),
    body);
}

// One capability: what it means, whether this computer has it, and every resource that provides it.
export async function capabilityView(id) {
  const m = await api('capabilityMap');
  const c = m.capabilities.find(x => x.id === id);
  if (!c) return h('div', { class: 'page' }, empty('alert', 'Capability not found', id, btn('All capabilities', () => go('capabilities'), { kind: 'primary' })));
  const d = m.domains.find(x => x.id === c.domain) || { label: c.domain, sub: '' };
  const [cls, label] = STATUS[c.status];
  const lead = { ready: 'Your agents can already do this.', 'one-step': 'One install away.', project: 'Available as libraries for the projects you build, not as something the agent runs.', reference: 'Only reference material so far.', gap: 'Nothing on this computer does this yet.' }[c.status];
  const head = h('header', { class: 'sheet-head' }, areaArt(c.domain, 'lg'),
    h('div', null, h('h1', null, c.label), h('div', { class: 'sub' }, h('a', { href: `#/capabilities?domain=${encodeURIComponent(c.domain)}` }, d.label), h('span', null, c.mode === 'agent' ? 'Used by the agent' : 'For building projects'), h('span', { class: `state ${cls}` }, label))));
  const bar = h('div', { class: 'actionbar' },
    c.status === 'one-step' && c.recommended ? btn(`Install ${c.recommended.name}`, () => getVia(c.recommended, () => go(`capability/${encodeURIComponent(c.id)}`)), { kind: 'primary', iconName: 'download' }) : h('span', { class: 'lead' }, lead),
    h('span', { class: 'grow' }),
    btn('Find more on GitHub', () => go(`library?tab=new&intent=${encodeURIComponent(c.label)}`), { kind: 'ghost', iconName: 'radar' }));
  const providers = c.providers.map(pv => resourceCard(pv, {
    action: !pv.state && pv.ready && pv.installable ? btn('Get', () => getVia(pv, () => go(`capability/${encodeURIComponent(c.id)}`)), { size: 'sm', kind: 'pill get', iconName: 'download' }) : null }));
  const siblings = m.capabilities.filter(x => x.domain === c.domain && x.id !== c.id);
  return h('div', { class: 'page' }, head, bar,
    h('p', { class: 'prose cap-can' }, c.can),
    h('div', { class: 'sec' }, h('h2', null, 'What provides it'), h('span', { class: 'meta' }, c.counts.total > c.providers.length ? `the ${c.providers.length} best of ${c.counts.total}` : `${c.providers.length} in the catalogue`)),
    providers.length ? h('div', { class: 'cat-grid', role: 'list' }, providers) : empty('radar', 'Nothing in the catalogue yet', 'Search GitHub and CURI will inspect what it finds.', btn('Search GitHub', () => go(`library?tab=new&intent=${encodeURIComponent(c.label)}`), { kind: 'primary', iconName: 'radar' })),
    siblings.length ? [h('div', { class: 'sec' }, h('h2', null, `More in ${d.label}`)),
      h('div', { class: 'capchips' }, siblings.map(x => h('a', { class: `capchip ${x.status === 'ready' ? 'on' : ''}`, href: `#/capability/${encodeURIComponent(x.id)}` }, x.label)))] : null);
}
