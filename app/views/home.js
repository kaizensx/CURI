// Home: the state of this device's agent environment at a glance (the constellation), plain statements
// of what is true, the next steps that add the most, relevant discoveries, and what CURI did on its own.
import { h, s, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty } from '../lib/ui.js';
import { go } from '../app.js';
import { runOperation } from './control.js';
import { runAction } from './common.js';

const MODE = { standard: 'Padrão', automatic: 'Automático', maximum: 'Autonomia máxima' };

// Rings: agents present (inner), capability areas as arcs (outer; green = available, blue = one step).
function constellation(map, agents) {
  const S = 520, c = S / 2, R1 = 92, R2 = 186;
  const doms = map.domains.map(d => ({ ...d, list: map.capabilities.filter(x => x.domain === d.id && x.mode === 'agent') })).filter(d => d.list.length);
  const total = doms.reduce((n, d) => n + d.list.length, 0);
  const gap = 0.045, span = Math.PI * 2 - gap * doms.length;
  let a = -Math.PI / 2;
  const pt = (r, t) => [c + r * Math.cos(t), c + r * Math.sin(t)];
  const arc = (r, t0, t1) => { const [x0, y0] = pt(r, t0), [x1, y1] = pt(r, t1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${t1 - t0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const groups = doms.map((d, i) => {
    const w = span * d.list.length / total, t0 = a, t1 = a + w;
    a = t1 + gap;
    const ready = d.list.filter(x => x.status === 'ready').length, step = d.list.filter(x => x.status === 'one-step').length;
    const tr = t0 + w * ready / d.list.length, ts = tr + w * step / d.list.length;
    const len = (rr, x0, x1) => (rr * (x1 - x0)).toFixed(1);
    const mid = (t0 + t1) / 2, [lx, ly] = pt(R2 + 30, mid);
    const g = s('g', { class: 'dom', tabindex: '0', role: 'link', 'aria-label': `${d.label}: ${ready} de ${d.list.length} disponíveis, ${step} a um passo` },
      s('title', null, `${d.label} — ${ready}/${d.list.length} disponíveis${step ? `, ${step} a um passo` : ''}`),
      s('path', { class: 'arc-bg', d: arc(R2, t0, t1), 'stroke-width': 14 }),
      ready ? s('path', { class: 'arc-ready', d: arc(R2, t0, tr), 'stroke-width': 14, style: `--i:${i};--len:${len(R2, t0, tr)};stroke-dasharray:${len(R2, t0, tr)}` }) : null,
      step ? s('path', { class: 'arc-step', d: arc(R2, tr, ts), 'stroke-width': 14, style: `--i:${i};--len:${len(R2, tr, ts)};stroke-dasharray:${len(R2, tr, ts)}` }) : null,
      w > 0.22 ? s('text', { x: lx.toFixed(1), y: ly.toFixed(1), 'text-anchor': Math.cos(mid) > 0.25 ? 'start' : Math.cos(mid) < -0.25 ? 'end' : 'middle', 'dominant-baseline': 'middle' }, d.label) : null,
      s('path', { class: 'domain-hit', d: arc(R2, t0, t1), 'stroke-width': 34, stroke: 'transparent' }));
    const open = () => go(`capabilities?domain=${d.id}`);
    g.addEventListener('click', open);
    g.addEventListener('keydown', e => e.key === 'Enter' && open());
    return g;
  });
  const present = agents.filter(x => x.present);
  const nodes = present.map((ag, i) => {
    const t = -Math.PI / 2 + i * (Math.PI * 2 / Math.max(present.length, 1));
    const [x, y] = pt(R1, t);
    const on = ag.counts.mcp + ag.counts.skills + ag.counts.plugins + ag.counts.account_skills > 0;
    const [tx, ty] = pt(R1 + 2, t);
    return [s('line', { class: 'spoke', x1: c, y1: c, x2: x.toFixed(1), y2: y.toFixed(1) }),
      s('circle', { class: `node ${on ? 'on' : ''}`, cx: x.toFixed(1), cy: y.toFixed(1), r: 7, style: `--i:${i}` }),
      s('text', { class: 'agent-label', x: tx.toFixed(1), y: (ty + (Math.sin(t) >= 0 ? 22 : -14)).toFixed(1), 'text-anchor': 'middle' }, ag.label)];
  });
  return s('svg', { class: 'constellation', viewBox: `-80 -30 ${S + 160} ${S + 60}`, role: 'img', 'aria-label': `${present.length} agentes encontrados; ${map.summary.agent_ready} de ${map.summary.agent_total} capacidades de agente disponíveis` },
    s('circle', { class: 'orbit', cx: c, cy: c, r: R1 }), s('circle', { class: 'orbit', cx: c, cy: c, r: R2 - 22, 'stroke-dasharray': '1 5' }),
    ...nodes.flat(), s('circle', { class: 'core', cx: c, cy: c, r: 30 }),
    s('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'agent-label' }, String(map.summary.agent_ready)),
    s('text', { x: c, y: c + 13, 'text-anchor': 'middle' }, `de ${map.summary.agent_total}`),
    ...groups);
}

export async function home() {
  const [map, dev, maint, pol, cands, lib] = await Promise.all([api('capabilityMap'), api('device'), api('maintenance'), api('policy'), api('candidatesAll', { limit: 200 }).catch(() => []), api('library')]);
  const agents = dev.scan?.agents || [];
  const presentAgents = agents.filter(a => a.present);
  const here = lib.filter(r => ['installed', 'configured', 'account'].includes(r.state));
  const s0 = map.summary;
  const stmt = (glyph, cls, ...txt) => h('div', { class: 'statement' }, h('span', { class: `glyph ${cls}` }, icon(glyph)), h('p', null, ...txt));
  const fresh = [];
  const seen = new Set();
  for (const c of cands) if (c.decision === 'candidate' && !c.in_registry && !seen.has(c.full_name) && (c.score?.agent?.score ?? 0) >= 0.6) { seen.add(c.full_name); fresh.push(c); }
  fresh.sort((a, b) => b.score.agent.score - a.score.agent.score);
  const getVia = async res => { const v = await api('resourceView', { id: res.id }); const a = v.actions.primary || v.actions.install.find(x => !x.disabled); if (!a) return go(`resource/${encodeURIComponent(res.id)}`); await runAction(a, res.name, () => location.reload()); };

  if (!dev.scan?.agents) {
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'O seu ambiente de agentes'), h('p', null, 'O CURI começa por ver o que já tem: agentes, servidores MCP, skills, plugins e ferramentas. Só lê; nada é alterado.'))),
      empty('device', 'Ainda não sabemos o que está neste dispositivo', null, btn('Detetar agora', () => runOperation('system.scan', {}, 'Detetar o que está instalado'), { kind: 'primary', iconName: 'refresh' })));
  }
  const last = maint.last;
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'O seu ambiente de agentes'),
      h('p', null, 'O que os seus agentes conseguem fazer neste dispositivo, o que falta e o que o CURI está a tratar por si.')),
      h('div', { class: 'actions' }, btn('Detetar agora', () => runOperation('system.scan', {}, 'Detetar o que está instalado'), { kind: 'ghost', iconName: 'refresh' }))),
    h('section', { class: 'home-hero' },
      h('div', { class: 'statements' },
        stmt('check', 'g', h('b', null, `${s0.agent_ready} de ${s0.agent_total}`), ' capacidades de agente estão disponíveis, através de ', h('b', null, String(presentAgents.length)), ` agente${presentAgents.length === 1 ? '' : 's'}: ${presentAgents.map(a => a.label).join(', ')}.`),
        stmt('download', 'b', h('b', null, String(s0.agent_one_step)), ' ficam disponíveis com uma única ação a partir do CURI.'),
        stmt('layers', 'n', h('b', null, String(here.length)), ' recursos do catálogo já estão aqui ou na sua conta — reconhecidos sem os reinstalar.'),
        stmt('bolt', 'n', 'Modo ', h('b', null, MODE[pol.consent.mode] || pol.consent.mode), last ? `: última manutenção ${relTime(last.at)}, ${last.queued} tarefa(s) feitas sozinhas${last.suggestions ? `, ${last.suggestions} à espera de autorização` : ''}.` : ': a manutenção automática ainda não correu.',
          ' ', h('a', { href: '#/automation', class: 'link' }, 'Ajustar'))),
      h('figure', { style: { margin: 0 } }, constellation(map, agents), h('figcaption', { class: 'legend-inline' }, h('span', null, h('i', { style: { background: 'var(--presence)' } }), 'disponível'), h('span', null, h('i', { style: { background: 'var(--one-step)', opacity: '.6' } }), 'a um passo'), h('span', null, h('i', { style: { background: 'var(--surface-4)' } }), 'por obter')))),
    h('div', { class: 'cols-home' },
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Próximos passos'), h('span', { class: 'meta' }, 'o que mais acrescenta aos seus agentes'), h('span', { class: 'end' }, btn('Todas as capacidades', () => go('capabilities'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
        map.recommendations.length ? h('div', { class: 'box' }, map.recommendations.slice(0, 6).map(r => h('div', { class: 'next' },
          h('div', null, h('div', { class: 'cap-t' }, r.label), h('div', { class: 'via' }, `${r.can} — `, h('a', { href: `#/resource/${encodeURIComponent(r.resource.id)}` }, r.resource.name), ` (${r.resource.kind_label})`)),
          btn('Obter', () => getVia(r.resource), { size: 'sm', kind: 'primary', iconName: 'download' })))) : empty('check', 'Nada urgente', 'As capacidades de agente com fornecedores no catálogo já estão disponíveis.')),
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Descobertas relevantes'), h('span', { class: 'end' }, btn('Descobrir', () => go('discover'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
        fresh.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, fresh.slice(0, 5).map(c => h('li', null, icon('sparkle', 'sm'),
          h('div', { class: 'grow' }, h('div', null, c.full_name.split('/')[1]), h('div', { class: 't2' }, c.score.agent.how || c.description || '')),
          h('span', { class: 'muted num' }, `${compact(c.stars)} ★`))))) :
          h('div', { class: 'box pad' }, h('p', { class: 'prose dim', style: { margin: 0 } }, 'Ainda sem descobertas acima do limiar de relevância. Procure por uma necessidade concreta ou ligue o GitHub para rever as suas estrelas.'), h('div', { style: { marginTop: '12px' } }, btn('Procurar', () => go('discover'), { size: 'sm', iconName: 'radar' }))),
        maint.suggestions?.length ? [h('div', { class: 'sec' }, h('h2', null, 'À espera de autorização'), h('span', { class: 'meta' }, 'fora do que o modo atual cobre')),
          h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, maint.suggestions.slice(0, 4).map(sg => h('li', null, icon('shield', 'sm'), h('div', { class: 'grow' }, h('div', null, sg.label), h('div', { class: 't2' }, sg.reason || '')),
            btn('Executar', () => runOperation(sg.kind, sg.params, sg.label), { size: 'sm' })))))] : null)));
}
