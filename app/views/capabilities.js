// Capabilities: what the agents on this device can do, what one action away would add, and what only
// exists as project libraries or references. Each "one step" capability carries a working action.
import { h, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toggle } from '../lib/ui.js';
import { go, params } from '../app.js';
import { runAction, stateChip } from './common.js';

const STATUS = { ready: ['installed', 'Disponível'], 'one-step': ['available', 'A um passo'], project: ['project', 'Em projetos'], reference: ['reference', 'Só referência'], gap: ['reference', 'Em falta'] };
const ORDER = { ready: 0, 'one-step': 1, project: 2, reference: 3, gap: 4 };

export async function capabilitiesView() {
  const p = params();
  const m = await api('capabilityMap');
  const st = { domain: p.get('domain') || '', agentOnly: p.get('all') !== '1', focus: p.get('focus') || '' };
  const bar = h('div', { class: 'dombar', role: 'group', 'aria-label': 'Áreas' });
  const grid = h('div', { class: 'capgrid' });
  const sumLine = h('p');

  const getVia = async c => {
    const v = await api('resourceView', { id: c.recommended.id });
    const a = v.actions.primary || v.actions.install.find(x => !x.disabled);
    if (!a) { go(`resource/${encodeURIComponent(c.recommended.id)}`); return; }
    await runAction(a, c.recommended.name, () => location.reload());
  };
  const card = c => {
    const [cls, label] = STATUS[c.status];
    const present = new Set(c.present);
    return h('article', { class: `cap ${c.status === 'ready' ? 'ready' : ''}`, id: `cap-${c.id}` },
      h('div', { class: 'top' }, h('strong', null, c.label), h('span', { class: `state ${cls}` }, label)),
      h('p', null, c.can),
      c.providers.length ? h('div', { class: 'prov' }, c.providers.slice(0, 6).map(pv => h('a', { href: `#/resource/${encodeURIComponent(pv.id)}`, class: present.has(pv.id) ? 'on' : '', title: pv.kind_label }, pv.name))) : null,
      c.status === 'one-step' && c.recommended ? h('div', { class: 'foot' }, h('span', { class: 'via' }, `Recomendado: ${c.recommended.name} (${c.recommended.kind_label})`), btn('Obter', () => getVia(c), { size: 'sm', kind: 'primary', iconName: 'download' })) : null,
      c.status === 'gap' ? h('div', { class: 'foot' }, h('span', { class: 'via' }, 'Nada no catálogo ainda.'), btn('Procurar', () => go(`discover?intent=${encodeURIComponent(c.label)}`), { size: 'sm', iconName: 'radar' })) : null);
  };
  const render = () => {
    const caps = m.capabilities.filter(c => (!st.agentOnly || c.mode === 'agent') && (!st.domain || c.domain === st.domain)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.label.localeCompare(b.label));
    fill(bar, m.domains.map(d => {
      const list = m.capabilities.filter(c => c.domain === d.id && (!st.agentOnly || c.mode === 'agent'));
      if (!list.length) return null;
      const ready = list.filter(c => c.status === 'ready').length, step = list.filter(c => c.status === 'one-step').length;
      const b = h('button', { type: 'button', class: 'dom-btn', 'aria-pressed': String(st.domain === d.id), title: d.sub },
        h('span', { class: 'l' }, h('span', null, d.label), h('span', null, `${ready}/${list.length}`)),
        h('span', { class: 'seg3', 'aria-hidden': 'true' }, h('i', { class: 'r', style: { width: `${ready / list.length * 100}%` } }), h('i', { class: 'o', style: { width: `${step / list.length * 100}%` } })));
      b.addEventListener('click', () => { st.domain = st.domain === d.id ? '' : d.id; render(); });
      return b;
    }));
    fill(grid, caps.map(card));
    const s = m.summary;
    fill(sumLine, h('b', null, `${s.agent_ready} de ${s.agent_total}`), ' capacidades de agente já estão disponíveis neste dispositivo; ', h('b', null, String(s.agent_one_step)), ' ficam disponíveis com uma única ação.');
    if (st.focus) requestAnimationFrame(() => { document.getElementById(`cap-${st.focus}`)?.scrollIntoView({ block: 'center' }); st.focus = ''; });
  };
  const onlyAgent = toggle('agent-only', st.agentOnly, 'Só o que o agente usa diretamente', 'Esconde conhecimento para construir projetos (bibliotecas, componentes).');
  onlyAgent.input.addEventListener('change', e => { st.agentOnly = e.target.checked; render(); });
  render();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Capacidades'), sumLine)),
    m.recommendations.length ? h('section', null,
      h('div', { class: 'sec' }, h('h2', null, 'Os passos que mais acrescentam'), h('span', { class: 'meta' }, 'capacidades de agente em falta que uma ação resolve')),
      h('div', { class: 'box' }, m.recommendations.slice(0, 5).map(r => h('div', { class: 'next' },
        h('div', null, h('div', { class: 'cap-t' }, r.label), h('div', { class: 'via' }, `${r.can} — com ${r.resource.name}`)),
        btn('Obter', () => getVia({ recommended: r.resource }), { size: 'sm', kind: 'primary', iconName: 'download' }))))) : null,
    h('div', { class: 'sec' }, h('h2', null, 'Por área'), h('span', { class: 'end' }, onlyAgent.el)),
    bar, grid);
}
