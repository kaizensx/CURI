// CURI icon set: 24-unit grid, 1.6 stroke, drawn for this product (no third-party glyphs).
import { s } from './dom.js';

const P = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 7h6V4h-6z',
  welcome: 'M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z',
  wizard: 'M5 6h14M5 12h9M5 18h5M17 15l2 2 3-4',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.8-1 3.7 15.5-3.8 1z',
  radar: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12l6.4-6.4M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  map: 'M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v10h-4zM4 16h11v4H4z',
  compare: 'M12 3v18M5 7h4M5 11h4M5 15h4M15 7h4M15 11h4M15 15h4',
  skills: 'M9 3h6v3a2 2 0 1 0 0 4v4h-4a2 2 0 1 1-4 0H3V8h4a2 2 0 1 0 0-4V3zM15 10h4v4a2 2 0 1 1 0 4v3h-6',
  mcp: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
  bridge: 'M9 15l6-6M10.5 6.5l1.8-1.8a4.2 4.2 0 0 1 6 6l-1.8 1.8M13.5 17.5l-1.8 1.8a4.2 4.2 0 0 1-6-6l1.8-1.8',
  shield: 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM9 12l2 2 4-4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  audit: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 8h.01',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  star: 'M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6-5-2.9-5 2.9 1.2-5.6L4 9.6l5.6-.6z',
  git: 'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6 8v8M18 11c0 3-4 3-8 5',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  copy: 'M9 9h10v11H9zM5 15H4V4h11v1',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  device: 'M3 5h18v11H3zM8 20h8M12 16v4',
  agent: 'M12 3a4 4 0 110 8 4 4 0 010-8zM5 21v-2a5 5 0 015-5h4a5 5 0 015 5v2M18 3.5l1.2 1.2M19.5 7H21',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  compass: 'M12 3a9 9 0 110 18 9 9 0 010-18zM15.5 8.5l-2 5-5 2 2-5z',
  power: 'M12 3v8M7 6.5a7 7 0 1010 0',
  cloud: 'M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18z',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
};

export function icon(name, cls = '') {
  return s('svg', { class: `i ${cls}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: P[name] || P.info }));
}

// Brand mark ("Aperture"): same geometry as brand/build.mjs. small=true uses the two-ring variant.
function arcD(c, r, a0, a1) {
  const p = a => [c + r * Math.cos(a * Math.PI / 180), c + r * Math.sin(a * Math.PI / 180)].map(n => n.toFixed(2)).join(' ');
  return `M${p(a0)} A${r} ${r} 0 1 1 ${p(a1)}`;
}
export function brandMark({ small = false, size = 26, gradient = true } = {}) {
  const id = `bm${Math.random().toString(36).slice(2, 7)}`;
  const arcs = small ? [[186, 44, 316, 64], [86, 64, 296, 64]] : [[204, 36, 324, 38], [140, 50, 310, 38], [76, 68, 292, 38]];
  const dot = small ? [442, 40] : [460, 24];
  return s('svg', { class: 'brand-svg', width: size, height: size, viewBox: '0 0 512 512', 'aria-hidden': 'true' },
    gradient ? s('defs', null, s('linearGradient', { id, x1: 0, y1: 52, x2: 0, y2: 460, gradientUnits: 'userSpaceOnUse' }, s('stop', { offset: 0, 'stop-color': 'var(--brand-hi)' }), s('stop', { offset: 1, 'stop-color': 'var(--brand-lo)' }))) : null,
    ...arcs.map(([r, a0, a1, w]) => s('path', { d: arcD(256, r, a0, a1), fill: 'none', stroke: gradient ? `url(#${id})` : 'currentColor', 'stroke-width': w, 'stroke-linecap': 'round' })),
    s('circle', { cx: dot[0], cy: 256, r: dot[1], fill: 'var(--signal-strong)' }));
}
