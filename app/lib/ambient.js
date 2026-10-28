// Ambient background for the Home header: the "Phosphor Flow" WebGL field exported from HorizonX
// (horizonx.so/shaders/phosphor-flow) through its MCP server, recoloured to CURI's palette and trimmed
// to what the app needs. It stays dim, renders at a capped resolution, and pauses when the page is
// hidden, scrolled away, or the user prefers reduced motion.
const VERT = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}';
const FRAG = `
precision highp float;
uniform vec2 resolution;
uniform float time, scale, brightness;
uniform vec3 background, midtone, highlight;
void main() {
  vec2 coord = (gl_FragCoord.xy - resolution * 0.5) / scale + resolution * 0.5;
  vec3 ray = normalize(vec3(coord, time) * 2.0 - resolution.xyy);
  vec3 energy = vec3(0.0);
  float z = 0.0, d = 0.0, s = 0.0;
  for (int i = 0; i < 60; i++) {
    vec3 p = z * ray;
    vec3 a = normalize(cos(vec3(5.0, 0.0, 1.0) + time - d * 4.0));
    p.z += 5.0;
    a = a * dot(a, p) - cross(a, p);
    for (int layer = 2; layer <= 9; layer++) { float f = float(layer); a -= sin(a * f + time).zxy / f; }
    s = a.y;
    d = 0.1 * abs(length(p) - 3.0) + 0.07 * abs(cos(s));
    z += d;
    energy += (cos(s + vec3(0.0, 1.0, 8.0)) + 1.0) / max(d, 0.00001);
  }
  vec3 e = exp(-2.0 * energy * brightness / 5000.0);
  vec3 mapped = (1.0 - e) / (1.0 + e);
  float light = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  vec3 colour = mix(background, midtone, smoothstep(0.0, 0.55, light));
  colour = mix(colour, highlight, smoothstep(0.35, 1.0, light));
  gl_FragColor = vec4(colour, 1.0);
}`;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

export function ambient(canvas, { background = '#08090b', midtone = '#1d2a44', highlight = '#7fa6ec', speed = 0.25, scale = 1.15, brightness = 0.5 } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return () => {};
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(prog, 'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['resolution', 'time', 'scale', 'brightness', 'background', 'midtone', 'highlight'].map(k => [k, gl.getUniformLocation(prog, k)]));
  gl.uniform3fv(u.background, rgb(background)); gl.uniform3fv(u.midtone, rgb(midtone)); gl.uniform3fv(u.highlight, rgb(highlight));
  gl.uniform1f(u.scale, scale); gl.uniform1f(u.brightness, brightness);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let t = 4.2, last = 0, frame = 0, visible = true, dead = false;
  const draw = () => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1, Math.sqrt(260000 / Math.max(1, box.width * box.height)));
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.uniform2f(u.resolution, w, h); gl.uniform1f(u.time, t); gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const off = () => document.documentElement.dataset.motion === 'off' || motion.matches;
  const tick = now => { frame = 0; t += (last ? Math.min((now - last) / 1000, 0.05) : 0) * speed; last = now; draw(); loop(); };
  const loop = () => { if (!frame && !dead && visible && !document.hidden && !off() && canvas.isConnected) frame = requestAnimationFrame(tick); else if (!canvas.isConnected) stop(); };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = 0; loop(); }); io.observe(canvas);
  const ro = new ResizeObserver(() => { draw(); }); ro.observe(canvas);
  const vis = () => { last = 0; loop(); };
  document.addEventListener('visibilitychange', vis);
  const stop = () => { dead = true; cancelAnimationFrame(frame); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis); };
  draw(); loop();
  return stop;
}
