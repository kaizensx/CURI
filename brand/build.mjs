// CURI brand build. One geometry source (arcs, lines, circles) -> SVG, PDF (true vectors), PNG (QuickLook),
// ICNS (iconutil). Run: node brand/build.mjs   (macOS; uses qlmanage, sips, iconutil — all built in).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = p => { const f = path.join(ROOT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
const rad = d => (d * Math.PI) / 180;
const f2 = n => Math.round(n * 100) / 100;

// ---------------- palette ----------------
export const C = {
  graphite900: '#0e0f12', graphite800: '#15171b', graphite700: '#1d1f25', graphite600: '#2a2d35',
  silverHi: '#f5f7fb', silverLo: '#9aa2b2', ink: '#16181d', inkSoft: '#4a505c', signal: '#5c8ff0', signalHi: '#9cbcff', paper: '#f6f7f9',
};

// ---------------- primitives ----------------
// arc: centre, radius, start/end angle in degrees (0 = east, counter-clockwise visually as y grows down -> we use screen angles clockwise)
const arc = (cx, cy, r, a0, a1, w) => ({ t: 'arc', cx, cy, r, a0, a1, w });
const line = (x1, y1, x2, y2, w) => ({ t: 'line', x1, y1, x2, y2, w });
const dot = (cx, cy, r, role = 'accent') => ({ t: 'dot', cx, cy, r, role });

// The selected mark, "Aperture": three concentric arcs opening east (a C, a radar, a lens), and the found
// resource sitting in the outer gap. Gaps widen inward so the opening reads as depth.
export function aperture({ size = 512, small = false } = {}) {
  const c = size / 2, k = size / 512;
  if (small) return [arc(c, c, 186 * k, 44, 316, 64 * k), arc(c, c, 86 * k, 64, 296, 64 * k), dot(c + 186 * k, c, 40 * k)];
  return [arc(c, c, 204 * k, 36, 324, 38 * k), arc(c, c, 140 * k, 50, 310, 38 * k), arc(c, c, 76 * k, 68, 292, 38 * k), dot(c + 204 * k, c, 24 * k)];
}

// Custom wordmark "CURI": monoline geometric letters, cap height 100 units, stroke 15, round terminals.
export function wordmark({ x = 0, y = 0, h = 100 } = {}) {
  const s = h / 100, W = 15 * s, top = y + 7.5 * s, bot = y + 92.5 * s, mid = (top + bot) / 2;
  const out = [];
  let cx = x;
  // C — echoes the symbol's opening
  out.push(arc(cx + 46 * s, y + 50 * s, 42.5 * s, 42, 318, W)); cx += 96 * s + 26 * s;
  // U
  out.push(line(cx + 7.5 * s, top, cx + 7.5 * s, y + 56 * s, W), arc(cx + 43.5 * s, y + 56 * s, 36 * s, 0, 180, W), line(cx + 79.5 * s, y + 56 * s, cx + 79.5 * s, top, W)); cx += 87 * s + 26 * s;
  // R
  out.push(line(cx + 7.5 * s, bot, cx + 7.5 * s, top, W), line(cx + 7.5 * s, top, cx + 44 * s, top, W), arc(cx + 44 * s, y + 31.25 * s, 23.75 * s, 270, 450, W), line(cx + 44 * s, y + 55 * s, cx + 7.5 * s, y + 55 * s, W), line(cx + 40 * s, y + 55 * s, cx + 76 * s, bot, W)); cx += 84 * s + 26 * s;
  // I
  out.push(line(cx + 7.5 * s, top, cx + 7.5 * s, bot, W)); cx += 15 * s;
  return { parts: out, width: cx - x };
}

// ---------------- SVG ----------------
function arcPath(p) {
  // screen coordinates (y down); angles measured clockwise from east
  const sx = p.cx + p.r * Math.cos(rad(p.a0)), sy = p.cy + p.r * Math.sin(rad(p.a0));
  const ex = p.cx + p.r * Math.cos(rad(p.a1)), ey = p.cy + p.r * Math.sin(rad(p.a1));
  const large = ((p.a1 - p.a0 + 360) % 360) > 180 ? 1 : 0;
  return `M${f2(sx)} ${f2(sy)} A${f2(p.r)} ${f2(p.r)} 0 ${large} 1 ${f2(ex)} ${f2(ey)}`;
}
function svgParts(parts, { stroke, accent }) {
  return parts.map(p => p.t === 'dot' ? `<circle cx="${f2(p.cx)}" cy="${f2(p.cy)}" r="${f2(p.r)}" fill="${p.role === 'accent' ? accent : stroke}"/>`
    : `<path d="${p.t === 'arc' ? arcPath(p) : `M${f2(p.x1)} ${f2(p.y1)} L${f2(p.x2)} ${f2(p.y2)}`}" fill="none" stroke="${stroke}" stroke-width="${f2(p.w)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n  ');
}
const svgDoc = (w, h, body, defs = '', title = 'CURI') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">\n  <title>${title}</title>\n  ${defs ? `<defs>${defs}</defs>\n  ` : ''}${body}\n</svg>\n`;
const silverGrad = (id, y1, y2) => `<linearGradient id="${id}" x1="0" y1="${y1}" x2="0" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.silverHi}"/><stop offset="1" stop-color="${C.silverLo}"/></linearGradient>`;

// ---------------- PDF (true vector, arcs as cubic Béziers) ----------------
function arcBeziers(p, flipY) {
  const segs = [];
  let a = p.a0, total = (p.a1 - p.a0 + 360) % 360 || 360;
  const n = Math.ceil(total / 90), step = total / n;
  const pt = d => [p.cx + p.r * Math.cos(rad(d)), flipY(p.cy + p.r * Math.sin(rad(d)))];
  for (let i = 0; i < n; i++, a += step) {
    const a2 = a + step, kk = (4 / 3) * Math.tan(rad(step) / 4);
    const [x0, y0] = pt(a), [x3, y3] = pt(a2);
    const d0 = [-Math.sin(rad(a)), Math.cos(rad(a))], d3 = [-Math.sin(rad(a2)), Math.cos(rad(a2))];
    const x1 = x0 + kk * p.r * d0[0], y1 = flipY(p.cy + p.r * Math.sin(rad(a)) + kk * p.r * d0[1]);
    const x2 = x3 - kk * p.r * d3[0], y2 = flipY(p.cy + p.r * Math.sin(rad(a2)) - kk * p.r * d3[1]);
    segs.push({ x0, y0, x1, y1, x2, y2, x3, y3 });
  }
  return segs;
}
const rgb = hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(' ');
function pdf(w, h, parts, { stroke, accent, background }) {
  const flip = y => h - y;
  let c = '';
  if (background) c += `${rgb(background)} rg 0 0 ${w} ${h} re f\n`;
  c += '1 J 1 j\n';
  for (const p of parts) {
    if (p.t === 'dot') {
      c += `${rgb(p.role === 'accent' ? accent : stroke)} rg\n`;
      const segs = arcBeziers({ ...p, a0: 0, a1: 360 }, flip);
      c += `${f2(segs[0].x0)} ${f2(segs[0].y0)} m\n` + segs.map(s => `${f2(s.x1)} ${f2(s.y1)} ${f2(s.x2)} ${f2(s.y2)} ${f2(s.x3)} ${f2(s.y3)} c`).join('\n') + '\nf\n';
    } else {
      c += `${rgb(stroke)} RG ${f2(p.w)} w\n`;
      if (p.t === 'line') c += `${f2(p.x1)} ${f2(flip(p.y1))} m ${f2(p.x2)} ${f2(flip(p.y2))} l S\n`;
      else { const segs = arcBeziers(p, flip); c += `${f2(segs[0].x0)} ${f2(segs[0].y0)} m\n` + segs.map(s => `${f2(s.x1)} ${f2(s.y1)} ${f2(s.x2)} ${f2(s.y2)} ${f2(s.x3)} ${f2(s.y3)} c`).join('\n') + '\nS\n'; }
    }
  }
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R >>`, `<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}endstream`];
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------- rendering helpers ----------------
// Native AppKit renderer (render.swift): exact pixel size, transparent background. Compiled on first use.
const RENDERER = path.join(fs.realpathSync('/tmp'), 'curi-brand-render');
function renderer() {
  if (!fs.existsSync(RENDERER) || fs.statSync(RENDERER).mtimeMs < fs.statSync(path.join(ROOT, 'render.swift')).mtimeMs)
    execFileSync('/usr/bin/xcrun', ['swiftc', '-O', path.join(ROOT, 'render.swift'), '-o', RENDERER], { stdio: 'inherit' });
  return RENDERER;
}
function pngExact(svgFile, outFile, w, h) { execFileSync(renderer(), [svgFile, outFile, String(w), String(h)]); }
const png = (svgFile, outFile, size) => pngExact(svgFile, outFile, size, size);
function resize(src, dst, px) { fs.copyFileSync(src, dst); execFileSync('/usr/bin/sips', ['-z', String(px), String(px), dst], { stdio: 'ignore' }); }

// ---------------- builds ----------------
function writeSymbolSet() {
  const S = 512, parts = aperture({ size: S });
  const color = svgDoc(S, S, svgParts(parts, { stroke: 'url(#sv)', accent: C.signal }), silverGrad('sv', 52, 460), 'CURI');
  const onLight = svgDoc(S, S, svgParts(parts, { stroke: C.ink, accent: C.signal }), '', 'CURI');
  const monoBlack = svgDoc(S, S, svgParts(parts, { stroke: '#000000', accent: '#000000' }), '', 'CURI');
  const monoWhite = svgDoc(S, S, svgParts(parts, { stroke: '#ffffff', accent: '#ffffff' }), '', 'CURI');
  const small = svgDoc(S, S, svgParts(aperture({ size: S, small: true }), { stroke: C.ink, accent: C.signal }), '', 'CURI');
  const smallDark = svgDoc(S, S, svgParts(aperture({ size: S, small: true }), { stroke: C.silverHi, accent: C.signal }), '', 'CURI');
  const files = { 'logo/curi-symbol-on-dark.svg': color, 'logo/curi-symbol-on-light.svg': onLight, 'logo/curi-symbol-mono-black.svg': monoBlack, 'logo/curi-symbol-mono-white.svg': monoWhite, 'logo/curi-symbol-small-on-light.svg': small, 'logo/curi-symbol-small-on-dark.svg': smallDark };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(OUT(f), c);
  fs.writeFileSync(OUT('logo/curi-symbol.pdf'), pdf(S, S, parts, { stroke: C.ink, accent: C.signal }));
  fs.writeFileSync(OUT('logo/curi-symbol-on-dark.pdf'), pdf(S, S, parts, { stroke: C.silverHi, accent: C.signal, background: C.graphite800 }));
}

function writeLockups() {
  const H = 512 * 0.62, pad = 40;
  for (const [name, stroke, accent, bg, defs] of [['on-dark', 'url(#sv)', C.signal, C.graphite800, silverGrad('sv', 0, 512)], ['on-light', C.ink, C.signal, null, ''], ['mono-black', '#000', '#000', null, ''], ['mono-white', '#fff', '#fff', null, '']]) {
    // horizontal: symbol + wordmark, wordmark cap height = 46% of symbol
    const sym = aperture({ size: 512 });
    const wm = wordmark({ x: 512 + 64, y: 256 - 118 / 2, h: 118 });
    const W = 512 + 64 + wm.width + pad, Hh = 512;
    const body = svgParts([...sym, ...wm.parts], { stroke, accent });
    fs.writeFileSync(OUT(`logo/curi-lockup-horizontal-${name}.svg`), svgDoc(Math.ceil(W), Hh, (bg ? `<rect width="100%" height="100%" fill="${bg}"/>\n  ` : '') + body, defs));
    // compact: symbol over wordmark
    const wm2 = wordmark({ x: 0, y: 0, h: 92 });
    const cw = Math.max(512, wm2.width);
    const wm2b = wordmark({ x: (cw - wm2.width) / 2, y: 512 + 36, h: 92 });
    const symC = aperture({ size: 512 }).map(p => ({ ...p, cx: p.cx + (cw - 512) / 2 }));
    fs.writeFileSync(OUT(`logo/curi-lockup-compact-${name}.svg`), svgDoc(Math.ceil(cw), 512 + 36 + 92 + 24, (bg ? `<rect width="100%" height="100%" fill="${bg}"/>\n  ` : '') + svgParts([...symC, ...wm2b.parts], { stroke, accent }), defs));
    if (name === 'on-light') fs.writeFileSync(OUT('logo/curi-lockup-horizontal.pdf'), pdf(Math.ceil(W), Hh, [...sym, ...wm.parts], { stroke: C.ink, accent: C.signal }));
  }
  const wmOnly = wordmark({ x: 20, y: 20, h: 100 });
  fs.writeFileSync(OUT('logo/curi-wordmark-on-light.svg'), svgDoc(Math.ceil(wmOnly.width + 40), 140, svgParts(wmOnly.parts, { stroke: C.ink, accent: C.signal })));
  fs.writeFileSync(OUT('logo/curi-wordmark-on-dark.svg'), svgDoc(Math.ceil(wmOnly.width + 40), 140, svgParts(wmOnly.parts, { stroke: C.silverHi, accent: C.signal })));
}

// macOS app icon: rounded-square tile (Apple grid: 824 tile in 1024 canvas), machined graphite, silver mark.
function appIconSvg({ small = false } = {}) {
  const S = 1024, tile = 824, o = (S - tile) / 2, r = 185;
  const markSize = small ? 640 : 600, mo = (S - markSize) / 2;
  const parts = aperture({ size: markSize, small }).map(p => (p.t === 'line' ? { ...p, x1: p.x1 + mo, x2: p.x2 + mo, y1: p.y1 + mo, y2: p.y2 + mo } : { ...p, cx: p.cx + mo, cy: p.cy + mo }));
  const defs = `<linearGradient id="tile" x1="0" y1="${o}" x2="0" y2="${o + tile}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2c2f37"/><stop offset=".55" stop-color="#191b20"/><stop offset="1" stop-color="#0f1013"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="${o}" x2="0" y2="${o + tile}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset=".35" stop-color="#ffffff" stop-opacity=".05"/><stop offset="1" stop-color="#ffffff" stop-opacity=".02"/></linearGradient>
    ${silverGrad('sv', mo + 40, mo + markSize - 40)}
    <radialGradient id="glow" cx="${mo + markSize / 2 + (small ? 186 : 204) * markSize / 512}" cy="${S / 2}" r="${small ? 120 : 90}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.signal}" stop-opacity=".45"/><stop offset="1" stop-color="${C.signal}" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".45"/></filter>`;
  const body = `<g filter="url(#sh)"><rect x="${o}" y="${o}" width="${tile}" height="${tile}" rx="${r}" fill="url(#tile)"/></g>
  <rect x="${o + 1.5}" y="${o + 1.5}" width="${tile - 3}" height="${tile - 3}" rx="${r - 1.5}" fill="none" stroke="url(#rim)" stroke-width="3"/>
  ${small ? '' : `<circle cx="${mo + markSize / 2 + 204 * markSize / 512}" cy="${S / 2}" r="90" fill="url(#glow)"/>`}
  ${svgParts(parts, { stroke: 'url(#sv)', accent: C.signalHi })}`;
  return svgDoc(S, S, body, defs, 'CURI');
}

function writeAppIcons() {
  fs.writeFileSync(OUT('icon/app-icon.svg'), appIconSvg());
  fs.writeFileSync(OUT('icon/app-icon-small.svg'), appIconSvg({ small: true }));
  png(OUT('icon/app-icon.svg'), OUT('export/app-icon-1024.png'), 1024);
  png(OUT('icon/app-icon-small.svg'), OUT('export/app-icon-small-1024.png'), 1024);
  const set = OUT('export/CURI.iconset/x');
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(set), { recursive: true });
  const dir = path.dirname(set);
  // Small sizes use the simplified two-ring mark so the aperture stays legible.
  for (const [px, name, src] of [[16, 'icon_16x16', 'small'], [32, 'icon_16x16@2x', 'small'], [32, 'icon_32x32', 'small'], [64, 'icon_32x32@2x', 'small'], [128, 'icon_128x128', 'full'], [256, 'icon_128x128@2x', 'full'], [256, 'icon_256x256', 'full'], [512, 'icon_256x256@2x', 'full'], [512, 'icon_512x512', 'full'], [1024, 'icon_512x512@2x', 'full']]) {
    resize(OUT(src === 'small' ? 'export/app-icon-small-1024.png' : 'export/app-icon-1024.png'), path.join(dir, `${name}.png`), px);
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', dir, '-o', OUT('export/CURI.icns')]);
  for (const px of [16, 32, 64, 128, 256, 512]) resize(OUT(px <= 64 ? 'export/app-icon-small-1024.png' : 'export/app-icon-1024.png'), OUT(`export/app-icon-${px}.png`), px);
  // favicon / web
  fs.writeFileSync(OUT('export/favicon.svg'), svgDoc(512, 512, `<rect width="512" height="512" rx="112" fill="${C.graphite800}"/>\n  ` + svgParts(aperture({ size: 512, small: true }).map(p => ({ ...p, cx: p.cx, cy: p.cy, r: p.r * 0.86, w: p.w * 0.86 })), { stroke: C.silverHi, accent: C.signalHi })));
  png(OUT('export/favicon.svg'), OUT('export/favicon-512.png'), 512);
  for (const px of [16, 32, 48, 180, 192]) resize(OUT('export/favicon-512.png'), OUT(`export/favicon-${px}.png`), px);
  // GitHub avatar (square, full bleed)
  fs.writeFileSync(OUT('export/github-avatar.svg'), svgDoc(1024, 1024, `<rect width="1024" height="1024" fill="${C.graphite800}"/>\n  ` + svgParts(aperture({ size: 1024 }).map(p => ({ ...p, cx: p.cx, cy: p.cy, r: p.r * 0.78, w: p.w * 0.9 })), { stroke: 'url(#sv)', accent: C.signal }), silverGrad('sv', 180, 850)));
  png(OUT('export/github-avatar.svg'), OUT('export/github-avatar-1024.png'), 1024);
  resize(OUT('export/github-avatar-1024.png'), OUT('export/github-avatar-500.png'), 500);
  for (const f of ['logo/curi-symbol-on-dark.svg', 'logo/curi-symbol-on-light.svg', 'logo/curi-symbol-mono-black.svg', 'logo/curi-symbol-mono-white.svg']) png(OUT(f), OUT(`export/${path.basename(f, '.svg')}-1024.png`), 1024);
}

function writeBanners() {
  const banner = (w, h, file, tagline) => {
    const symSize = h * 0.5, sx = w * 0.07, sy = (h - symSize) / 2;
    const sym = aperture({ size: symSize }).map(p => ({ ...p, cx: p.cx + sx, cy: p.cy + sy }));
    const tx = sx + symSize + h * 0.1;
    const wm = wordmark({ x: tx, y: h * 0.33, h: h * 0.15 });
    const defs = `${silverGrad('sv', sy, sy + symSize)}<radialGradient id="bgl" cx="${sx + symSize / 2}" cy="${h / 2}" r="${w * 0.6}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#20232a"/><stop offset="1" stop-color="${C.graphite900}"/></radialGradient>`;
    const grid = Array.from({ length: Math.ceil(w / 48) }, (_, i) => `<line x1="${i * 48}" y1="0" x2="${i * 48}" y2="${h}" stroke="#ffffff" stroke-opacity=".025"/>`).join('');
    const body = `<rect width="${w}" height="${h}" fill="url(#bgl)"/>${grid}
  ${svgParts([...sym, ...wm.parts], { stroke: 'url(#sv)', accent: C.signal })}
  <text x="${tx}" y="${h * 0.6}" fill="#a6aab3" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif" font-size="${Math.min(h * 0.045, (w - tx - w * 0.05) / (tagline.length * 0.5))}" letter-spacing="0.2">${tagline}</text>
  <text x="${tx}" y="${h * 0.68}" fill="#727782" font-family="'SF Mono', Menlo, monospace" font-size="${h * 0.028}" letter-spacing="2">CLAUDE UNIVERSAL RESOURCE INTELLIGENCE</text>`;
    fs.writeFileSync(OUT(`export/${file}.svg`), svgDoc(w, h, body, defs));
    pngExact(OUT(`export/${file}.svg`), OUT(`export/${file}.png`), w, h);
  };
  banner(1280, 640, 'github-social-preview', 'O registo local que mostra ao Claude a ferramenta certa.');
  banner(1600, 520, 'readme-hero', 'O registo local que mostra ao Claude a ferramenta certa.');
  // DMG window background (660x400 @1x and @2x): app on the left, Applications on the right.
  const dmg = scale => {
    const w = 660 * scale, h = 400 * scale;
    const defs = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1d1f25"/><stop offset="1" stop-color="${C.graphite900}"/></linearGradient>`;
    const ay = 190 * scale;
    const body = `<rect width="${w}" height="${h}" fill="url(#bg)"/>
  <path d="M${270 * scale} ${ay} H${390 * scale} M${372 * scale} ${ay - 14 * scale} L${392 * scale} ${ay} L${372 * scale} ${ay + 14 * scale}" fill="none" stroke="#5a606c" stroke-width="${3 * scale}" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${w / 2}" y="${330 * scale}" text-anchor="middle" fill="#a6aab3" font-family="-apple-system, 'SF Pro Text', sans-serif" font-size="${14 * scale}">Arraste o CURI para a pasta Aplicações</text>
  <text x="${w / 2}" y="${352 * scale}" text-anchor="middle" fill="#6c717c" font-family="-apple-system, 'SF Pro Text', sans-serif" font-size="${11.5 * scale}">Na primeira abertura, o CURI prepara o que falta e explica cada passo.</text>`;
    fs.writeFileSync(OUT(`export/dmg-background${scale > 1 ? '@2x' : ''}.svg`), svgDoc(w, h, body, defs));
    pngExact(OUT(`export/dmg-background${scale > 1 ? '@2x' : ''}.svg`), OUT(`export/dmg-background${scale > 1 ? '@2x' : ''}.png`), w, h);
  };
  dmg(1); dmg(2);
  banner(1400, 440, 'release-banner', 'Skills, MCP e ferramentas — verificados, nunca instalados às escondidas.');
}

// Three initial concepts, kept for the record (the selected one is "Aperture").
function writeConcepts() {
  const S = 512, c = S / 2;
  // A — Lodestar: a four-point navigation star; the east point is the discovery.
  const star = (r1, r2) => { const pts = []; for (let i = 0; i < 8; i++) { const a = rad(i * 45 - 90), r = i % 2 ? r2 : r1 * (i === 2 ? 1.18 : 1); pts.push(`${f2(c + r * Math.cos(a))},${f2(c + r * Math.sin(a))}`); } return pts.join(' '); };
  const a = svgDoc(S, S, `<rect width="512" height="512" fill="${C.graphite800}"/>\n  <polygon points="${star(200, 54)}" fill="${C.silverHi}"/>\n  <circle cx="${c}" cy="${c}" r="34" fill="${C.graphite800}"/>\n  <circle cx="${c + 236}" cy="${c}" r="14" fill="${C.signal}"/>`, '', 'Concept A — Lodestar');
  // B — Aperture (selected)
  const b = svgDoc(S, S, `<rect width="512" height="512" fill="${C.graphite800}"/>\n  ` + svgParts(aperture({ size: S }), { stroke: 'url(#sv)', accent: C.signal }), silverGrad('sv', 52, 460), 'Concept B — Aperture');
  // C — Index: three offset index plates forming a lowercase i with a diamond tittle (the registry).
  const plate = (y, x0, w) => `<rect x="${x0}" y="${y}" width="${w}" height="54" rx="27" fill="${C.silverHi}" fill-opacity="${y > 300 ? 1 : y > 230 ? 0.72 : 0.45}"/>`;
  const cc = svgDoc(S, S, `<rect width="512" height="512" fill="${C.graphite800}"/>\n  ${plate(196, 150, 212)}${plate(270, 176, 212)}${plate(344, 202, 212)}\n  <rect x="${c - 40}" y="88" width="56" height="56" rx="10" transform="rotate(45 ${c - 12} 116)" fill="${C.signal}"/>`, '', 'Concept C — Index');
  fs.writeFileSync(OUT('concepts/concept-a-lodestar.svg'), a);
  fs.writeFileSync(OUT('concepts/concept-b-aperture.svg'), b);
  fs.writeFileSync(OUT('concepts/concept-c-index.svg'), cc);
  for (const f of ['concept-a-lodestar', 'concept-b-aperture', 'concept-c-index']) png(OUT(`concepts/${f}.svg`), OUT(`concepts/${f}.png`), 512);
}

writeSymbolSet();
writeLockups();
writeAppIcons();
writeBanners();
writeConcepts();
console.log('brand assets written to', ROOT);
