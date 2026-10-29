// Home: the state of this device's agent environment at a glance (the constellation), plain statements
// of what is true, the next steps that add the most, relevant discoveries, and what CURI did on its own.
import { h, s, relTime, compact } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty } from '../lib/ui.js';
import { go } from '../app.js';
import { runOperation } from './control.js';
import { runAction } from './common.js';
import { ambient } from '../lib/ambient.js';

const MODE = { standard: 'Standard', automatic: 'Automatic', maximum: 'Maximum autonomy' };

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
    const g = s('g', { class: 'dom', tabindex: '0', role: 'link', 'aria-label': `${d.label}: ${ready} of ${d.list.length} available, ${step} one step away` },
      s('title', null, `${d.label} — ${ready}/${d.list.length} available${step ? `, ${step} one step away` : ''}`),
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
  return s('svg', { class: 'constellation', viewBox: `-80 -30 ${S + 160} ${S + 60}`, role: 'img', 'aria-label': `${present.length} agents found; ${map.summary.agent_ready} of ${map.summary.agent_total} agent capabilities available` },
    s('circle', { class: 'orbit', cx: c, cy: c, r: R1 }), s('circle', { class: 'orbit', cx: c, cy: c, r: R2 - 22, 'stroke-dasharray': '1 5' }),
    ...nodes.flat(), s('circle', { class: 'core', cx: c, cy: c, r: 30 }),
    s('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'agent-label' }, String(map.summary.agent_ready)),
    s('text', { x: c, y: c + 13, 'text-anchor': 'middle' }, `of ${map.summary.agent_total}`),
    ...groups);
}

// Three plain doors into the app, then what arrived lately from any agent or account.
function startHere(inv) {
  const items = inv.places.flatMap(p => p.groups.flatMap(g => g.items.filter(it => it.added_at).map(it => ({ it, p }))))
    .sort((a, b) => b.it.added_at.localeCompare(a.it.added_at)).slice(0, 5);
  const door = (ic, title, text, to) => { const b = h('button', { type: 'button', class: 'door' }, h('span', { class: 'ic' }, icon(ic)), h('strong', null, title), h('span', null, text), h('span', { class: 'go' }, icon('chevron', 'sm'))); b.addEventListener('click', () => go(to)); return b; };
  const total = inv.places.reduce((n, p) => n + p.count, 0);
  return h('section', { class: 'start' },
    h('div', { class: 'doors' },
      door('check', 'See what I have', `${total} things across your agents, your claude.ai account and this computer.`, 'library?tab=installed&place='),
      door('download', 'Get something new', 'Browse the catalogue and install in one click, with progress.', 'library?tab=catalogue'),
      door('map', 'What can my agents do?', 'Capabilities in plain words, and the one step that adds each missing one.', 'capabilities')),
    items.length ? h('div', { class: 'recent-box' },
      h('div', { class: 'sec' }, h('h2', null, 'Recently added'), h('span', { class: 'end' }, btn('See all', () => go('library?tab=installed&place=recent'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
      h('ul', { class: 'plain-list' }, items.map(({ it, p }) => h('li', null, icon(p.kind === 'account' ? 'cloud' : p.kind === 'computer' ? 'device' : 'agent', 'sm'),
        h('div', { class: 'grow' }, h('div', null, it.name), h('div', { class: 't2' }, `${p.label} · ${relTime(it.added_at)}`)))))) : null);
}

export async function home() {
  const [map, dev, maint, pol, cands, lib, inv] = await Promise.all([api('capabilityMap'), api('device'), api('maintenance'), api('policy'), api('candidatesAll', { limit: 200 }), api('library'), api('installed')]);
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
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Your agent environment'), h('p', null, 'CURI starts by looking at what you already have: agents, MCP servers, skills, plugins and tools. It only reads; nothing changes.'))),
      empty('device', 'We don\'t know what\'s on this device yet', null, btn('Scan now', () => runOperation('system.scan', {}, 'Detect what\'s installed'), { kind: 'primary', iconName: 'refresh' })));
  }
  const last = maint.last;
  // The one authored moment: a slow ambient field behind the header (HorizonX "Phosphor Flow").
  const canvas = h('canvas', { class: 'ambient', 'aria-hidden': 'true' });
  setTimeout(() => ambient(canvas), 0);
  return h('div', { class: 'page home' },
    h('div', { class: 'ambient-wrap', 'aria-hidden': 'true' }, canvas),
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Your agent environment'),
      h('p', null, 'What your agents can do on this device, what\'s missing, and what CURI is taking care of for you.')),
      h('div', { class: 'actions' }, btn('Scan now', () => runOperation('system.scan', {}, 'Detect what\'s installed'), { kind: 'ghost', iconName: 'refresh' }))),
    h('section', { class: 'home-hero' },
      h('div', { class: 'statements' },
        stmt('check', 'g', h('b', null, `${s0.agent_ready} of ${s0.agent_total}`), ' agent capabilities are available through ', h('b', null, String(presentAgents.length)), ` agent${presentAgents.length === 1 ? '' : 's'}: ${presentAgents.map(a => a.label).join(', ')}.`),
        stmt('download', 'b', h('b', null, String(s0.agent_one_step)), ' more become available with a single action in CURI.'),
        stmt('layers', 'n', h('b', null, String(here.length)), ' catalogue resources are already here or in your account, recognised without reinstalling.'),
        stmt('bolt', 'n', 'Mode ', h('b', null, MODE[pol.consent.mode] || pol.consent.mode), last ? `: last maintenance ${relTime(last.at)}, ${last.queued} task(s) done on its own${last.suggestions ? `, ${last.suggestions} waiting for permission` : ''}.` : ': automatic maintenance hasn\'t run yet.',
          ' ', h('a', { href: '#/automation', class: 'link' }, 'Adjust'))),
      h('figure', { style: { margin: 0 } }, constellation(map, agents), h('figcaption', { class: 'legend-inline' }, h('span', null, h('i', { style: { background: 'var(--presence)' } }), 'available'), h('span', null, h('i', { style: { background: 'var(--one-step)', opacity: '.6' } }), 'one step away'), h('span', null, h('i', { style: { background: 'var(--surface-4)' } }), 'not yet available')))),
    startHere(inv),
    h('div', { class: 'cols-home' },
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Next steps'), h('span', { class: 'meta' }, 'what adds the most to your agents'), h('span', { class: 'end' }, btn('All capabilities', () => go('capabilities'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
        map.recommendations.length ? h('div', { class: 'box' }, map.recommendations.slice(0, 6).map(r => h('div', { class: 'next' },
          h('div', null, h('div', { class: 'cap-t' }, r.label), h('div', { class: 'via' }, `${r.can} — `, h('a', { href: `#/resource/${encodeURIComponent(r.resource.id)}` }, r.resource.name), ` (${r.resource.kind_label})`)),
          btn('Get', () => getVia(r.resource), { size: 'sm', kind: 'primary', iconName: 'download' })))) : empty('check', 'Nothing urgent', 'Every agent capability with a provider in the catalogue is already available.')),
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'New on GitHub'), h('span', { class: 'end' }, btn('See all', () => go('library?tab=new'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
        fresh.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, fresh.slice(0, 5).map(c => h('li', null, icon('sparkle', 'sm'),
          h('div', { class: 'grow' }, h('div', null, c.full_name.split('/')[1]), h('div', { class: 't2' }, c.score.agent.how || c.description || '')),
          h('span', { class: 'muted num' }, `${compact(c.stars)} ★`))))) :
          h('div', { class: 'box pad' }, h('p', { class: 'prose dim', style: { margin: 0 } }, 'No discoveries above the relevance threshold yet. Search for a concrete need, or connect GitHub to review your stars.'), h('div', { style: { marginTop: '12px' } }, btn('Search', () => go('discover'), { size: 'sm', iconName: 'radar' }))),
        maint.suggestions?.length ? [h('div', { class: 'sec' }, h('h2', null, 'Waiting for permission'), h('span', { class: 'meta' }, 'outside what the current mode covers')),
          h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, maint.suggestions.slice(0, 4).map(sg => h('li', null, icon('shield', 'sm'), h('div', { class: 'grow' }, h('div', null, sg.label), h('div', { class: 't2' }, sg.reason || '')),
            btn('Run', () => runOperation(sg.kind, sg.params, sg.label), { size: 'sm' })))))] : null)));
}
