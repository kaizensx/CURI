// Charts drawn from real registry data only. Missing evidence is shown as missing, never imputed.
import { h, s, compact } from './dom.js';
import { tooltip } from './ui.js';

export const KINDS = [
  { id: 'capability-first', label: 'Fronteira', color: 'var(--cat-1)' },
  { id: 'gap', label: 'Lacunas', color: 'var(--cat-2)' },
  { id: 'independent', label: 'Independente', color: 'var(--cat-3)' },
  { id: 'task', label: 'Tarefa', color: 'var(--cat-4)' },
];

function hash(str) { let x = 2166136261; for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; }

// Polar radar: sector = query strategy, radius = 1 - score (closer = stronger), size = stars at capture.
export function radar(candidates, { size = 520, onSelect, selected, sweep = true, compactLabels = false } = {}) {
  const c = size / 2, R = c - 46;
  const svg = s('svg', { class: 'radar', viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `Radar de ${candidates.length} candidatos por estratégia e pontuação` });
  const defs = s('defs', null,
    s('radialGradient', { id: 'rg-glow' }, s('stop', { offset: '0%', 'stop-color': 'var(--signal)', 'stop-opacity': '.10' }), s('stop', { offset: '100%', 'stop-color': 'var(--signal)', 'stop-opacity': '0' })),
    s('linearGradient', { id: 'rg-sweep', x1: '0', y1: '0', x2: '1', y2: '0' }, s('stop', { offset: '0%', 'stop-color': 'var(--signal)', 'stop-opacity': '0' }), s('stop', { offset: '100%', 'stop-color': 'var(--signal)', 'stop-opacity': '.11' })));
  svg.append(defs, s('circle', { cx: c, cy: c, r: R, fill: 'url(#rg-glow)' }));
  // Radius encodes score: 1.0 at the centre, 0 at SCORE0; the outer band holds unscored candidates.
  const SCORE0 = 0.86;
  const rOf = total => (total == null ? R * 0.94 : R * (0.03 + (SCORE0 - 0.03) * (1 - total)));
  svg.append(s('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'var(--hairline-2)', 'stroke-width': 1 }));
  [0.75, 0.5, 0.25, 0].forEach(v => {
    svg.append(s('circle', { cx: c, cy: c, r: rOf(v), fill: 'none', stroke: 'var(--hairline-2)', 'stroke-width': 0.75, 'stroke-dasharray': v === 0 ? null : '2 4' }));
    svg.append(s('text', { x: c - 5, y: c - rOf(v) + 11, 'text-anchor': 'end', class: 'radar-tick' }, v.toFixed(2)));
  });
  svg.append(s('text', { x: c - 5, y: c - R + 11, 'text-anchor': 'end', class: 'radar-tick' }, 'sem score'));
  KINDS.forEach((k, i) => {
    const a = (i / KINDS.length) * Math.PI * 2 - Math.PI / 2;
    svg.append(s('line', { x1: c, y1: c, x2: c + Math.cos(a) * R, y2: c + Math.sin(a) * R, stroke: 'var(--hairline)', 'stroke-width': 1 }));
    const mid = a + Math.PI / KINDS.length;
    const lx = c + Math.cos(mid) * (R + 24), ly = c + Math.sin(mid) * (R + 24);
    const n = candidates.filter(x => x.query_kind === k.id).length;
    svg.append(s('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'radar-label' },
      s('tspan', { fill: k.color }, '● '), k.label, compactLabels ? null : s('tspan', { class: 'radar-count' }, `  ${n}`)));
  });
  if (sweep) {
    const g = s('g', { class: 'radar-sweep' }, s('path', { d: `M${c},${c} L${c + R},${c} A${R},${R} 0 0,0 ${c + Math.cos(-Math.PI / 5) * R},${c + Math.sin(-Math.PI / 5) * R} Z`, fill: 'url(#rg-sweep)' }));
    g.style.transformOrigin = `${c}px ${c}px`;
    svg.append(g);
  }
  const dots = s('g');
  const sorted = [...candidates].sort((a, b) => (a.score?.total ?? -1) - (b.score?.total ?? -1));
  for (const cand of sorted) {
    const ki = Math.max(0, KINDS.findIndex(k => k.id === cand.query_kind));
    const kind = KINDS[ki];
    const start = (ki / KINDS.length) * Math.PI * 2 - Math.PI / 2;
    const span = (Math.PI * 2) / KINDS.length;
    const a = start + span * (0.08 + 0.84 * hash(cand.full_name));
    const total = cand.score?.total;
    const rr = rOf(total);
    const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
    const r = Math.min(9, 3 + Math.log10((cand.stars || 0) + 1) * 1.4);
    const isSel = selected && selected === cand.id;
    const circle = s('circle', { cx: x, cy: y, r, class: `radar-dot ${cand.in_registry ? 'known' : ''} ${isSel ? 'sel' : ''}`, fill: cand.in_registry ? 'var(--surface-1)' : kind.color, stroke: cand.in_registry ? kind.color : 'var(--surface-1)', 'stroke-width': 2, tabindex: '0', role: 'button', 'aria-label': `${cand.full_name}, score ${total ?? 'n/d'}` });
    tooltip(circle, () => [h('span', { class: 'micro' }, `${kind.label} · ${cand.in_registry ? 'no registo' : 'novo'}`), h('strong', null, cand.full_name), h('div', { class: 'muted' }, `score ${total ?? 'n/d'} · confiança ${cand.score?.confidence ?? 0} · ★ ${compact(cand.stars)} na captura`)]);
    if (onSelect) { circle.addEventListener('click', () => onSelect(cand)); circle.addEventListener('keydown', e => e.key === 'Enter' && onSelect(cand)); }
    dots.append(circle);
  }
  svg.append(dots);
  return svg;
}

// Horizontal bars: total (muted step) with the verified portion (bright step) inside, one axis.
export function coverageBars(domains, { onPick } = {}) {
  const max = Math.max(1, ...domains.map(d => d.resources));
  return h('div', { class: 'hbars', role: 'list', 'aria-label': 'Recursos por domínio' }, domains.map((d, i) => {
    const row = h('button', { type: 'button', class: 'hbar', role: 'listitem', vars: { '--i': i }, 'aria-label': `${d.domain}: ${d.resources} recursos, ${d.verified} verificados${d.gaps ? `, ${d.gaps} lacunas` : ''}` },
      h('span', { class: 'hbar-label' }, d.domain),
      h('span', { class: 'hbar-track' },
        h('i', { class: 'hbar-total', style: { width: `${(d.resources / max) * 100}%` } }),
        h('i', { class: 'hbar-verified', style: { width: `${(d.verified / max) * 100}%` } })),
      h('span', { class: 'hbar-value num' }, d.resources, d.gaps ? h('em', { class: 'hbar-gap' }, `${d.gaps} lacuna${d.gaps > 1 ? 's' : ''}`) : null));
    tooltip(row, () => [h('span', { class: 'micro' }, d.domain), h('div', null, `${d.resources} recursos · ${d.verified} com fonte verificada`), d.gaps ? h('div', { class: 'muted' }, `Capacidades com < 2 recursos: ${d.gapLabels.join(', ')}`) : null]);
    if (onPick) row.addEventListener('click', () => onPick(d));
    return row;
  }));
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(([color, label, hollow]) => h('span', null, h('i', { class: hollow ? 'hollow' : '', style: { '--c': color, background: hollow ? 'transparent' : color, borderColor: color } }), label)));
}
