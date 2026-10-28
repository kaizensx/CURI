// Capabilities: what the agents on this device can do, what one action away would add, and what only
// exists as project libraries. Grouped by area; every "one step away" row carries a working action.
import { h, s, fill } from '../lib/dom.js';
import { api, btn, toggle } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runAction } from './common.js';

const STATUS = { ready: ['installed', 'Available'], 'one-step': ['available', 'One step away'], project: ['project', 'In projects'], reference: ['reference', 'Reference only'], gap: ['reference', 'Missing'] };
const ORDER = { ready: 0, 'one-step': 1, project: 2, reference: 3, gap: 4 };

// Small progress ring: green = available, blue = one step away.
function ring(ready, step, total) {
  const r = 15, c = 2 * Math.PI * r, a = total ? ready / total : 0, b = total ? step / total : 0;
  return s('svg', { class: 'ring', viewBox: '0 0 40 40', 'aria-hidden': 'true' },
    s('circle', { cx: 20, cy: 20, r, class: 'ring-bg' }),
    b ? s('circle', { cx: 20, cy: 20, r, class: 'ring-step', 'stroke-dasharray': `${(c * b).toFixed(1)} ${c}`, 'stroke-dashoffset': (-c * a).toFixed(1) }) : null,
    a ? s('circle', { cx: 20, cy: 20, r, class: 'ring-ready', 'stroke-dasharray': `${(c * a).toFixed(1)} ${c}` }) : null);
}

export async function capabilitiesView() {
  const p = params();
  const m = await api('capabilityMap');
  const st = { domain: p.get('domain') || '', agentOnly: p.get('all') !== '1', focus: p.get('focus') || '', status: '' };
  const body = h('div', { class: 'capsections' });
  const strip = h('div', { class: 'capstrip', role: 'group', 'aria-label': 'Areas' });
  const sumLine = h('p');

  const getVia = async res => {
    const v = await api('resourceView', { id: res.id });
    const a = v.actions.primary || v.actions.install.find(x => !x.disabled && !x.shared);
    if (!a) { go(`resource/${encodeURIComponent(res.id)}`); return; }
    await runAction(a, res.name, () => location.reload());
  };
  const row = c => {
    const [cls, label] = STATUS[c.status];
    const present = new Set(c.present);
    return h('div', { class: `caprow ${c.status}`, id: `cap-${c.id}` },
      h('span', { class: `state ${cls}` }, label),
      h('div', { class: 'what' }, h('strong', null, c.label), h('span', null, c.can)),
      h('div', { class: 'prov' }, c.providers.slice(0, 4).map(pv => h('a', { href: `#/resource/${encodeURIComponent(pv.id)}`, class: present.has(pv.id) ? 'on' : '', title: pv.kind_label }, pv.name)), c.providers.length > 4 ? h('span', { class: 'more' }, `+${c.providers.length - 4}`) : null),
      h('div', { class: 'act' }, c.status === 'one-step' && c.recommended ? btn(`Get ${c.recommended.name}`, () => getVia(c.recommended), { size: 'sm', kind: 'primary', iconName: 'download' })
        : c.status === 'gap' || c.status === 'reference' ? btn('Find one', () => go(`discover?intent=${encodeURIComponent(c.label)}`), { size: 'sm', kind: 'ghost', iconName: 'radar' }) : null));
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
    fill(body, m.domains.filter(d => !st.domain || d.id === st.domain).map(d => {
      const list = caps.filter(c => c.domain === d.id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.label.localeCompare(b.label));
      if (!list.length) return null;
      const ready = list.filter(c => c.status === 'ready').length, step = list.filter(c => c.status === 'one-step').length;
      return h('section', { class: 'capsec' },
        h('header', null, ring(ready, step, list.length), h('div', null, h('h2', null, d.label), h('span', null, d.sub)), h('span', { class: 'count' }, `${ready} of ${list.length} available${step ? ` · ${step} one step away` : ''}`)),
        h('div', { class: 'caprows' }, list.map(row)));
    }));
    const sm = m.summary;
    fill(sumLine, h('b', null, `${sm.agent_ready} of ${sm.agent_total}`), ' agent capabilities are already available on this device; ', h('b', null, String(sm.agent_one_step)), ' more become available with one action.');
    if (st.focus) requestAnimationFrame(() => { const el = document.getElementById(`cap-${st.focus}`); el?.scrollIntoView({ block: 'center' }); el?.classList.add('flash'); st.focus = ''; });
  };
  const onlyAgent = toggle('agent-only', st.agentOnly, 'Only what the agent uses directly', 'Hides knowledge for building projects (libraries, components).');
  onlyAgent.input.addEventListener('change', e => { st.agentOnly = e.target.checked; render(); });
  const statusTabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Status' }, [['', 'All'], ['ready', 'Available'], ['one-step', 'One step away'], ['gap', 'Missing']].map(([v, l]) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.status === v) }, l);
    b.addEventListener('click', () => { st.status = v; statusTabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); render(); });
    return b;
  }));
  render();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Capabilities'), sumLine)),
    m.recommendations.length ? h('section', { class: 'recos' },
      h('div', { class: 'sec' }, h('h2', null, 'The steps that add the most'), h('span', { class: 'meta' }, 'missing agent capabilities that one action fixes')),
      h('div', { class: 'reco-grid' }, m.recommendations.slice(0, 4).map(r => h('article', { class: 'reco' },
        h('span', { class: 'state available' }, 'One step away'), h('strong', null, r.label), h('p', null, r.can),
        h('div', { class: 'reco-foot' }, h('a', { href: `#/resource/${encodeURIComponent(r.resource.id)}` }, r.resource.name), btn('Get', () => getVia(r.resource), { size: 'sm', kind: 'primary', iconName: 'download' })))))) : null,
    h('div', { class: 'sec' }, h('h2', null, 'By area'), h('span', { class: 'end' }, statusTabs, onlyAgent.el)),
    strip, body);
}
