// Boot window: shows live dependency progress emitted by the Rust shell, then the shell navigates
// this window to the CURI Core UI.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const ORDER = [['node', 'Runtime Node.js'], ['git', 'Git'], ['claude', 'Claude Code CLI'], ['core', 'CURI Core']];
const LABEL = { pending: 'pending', running: 'running', done: 'done', skipped: 'skipped', warning: 'attention', failed: 'failed' };
const items = new Map();

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

for (const [id, label] of ORDER) {
  const li = el('li');
  const head = el('div', 'head');
  const name = el('strong', null, label);
  const state = el('span', 'state', LABEL.pending);
  head.append(name, state);
  const detail = el('div', 'detail', '');
  const bar = el('div', 'bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.append(el('span'));
  li.append(head, detail, bar);
  document.getElementById('steps').append(li);
  items.set(id, { state, detail, bar });
}

function update(p) {
  const it = items.get(p.step);
  if (!it) return;
  it.state.textContent = LABEL[p.state] || p.state;
  it.state.className = `state ${p.state}`;
  it.detail.textContent = p.detail || '';
  const running = p.state === 'running';
  const pct = p.pct == null ? (p.state === 'done' ? 100 : null) : p.pct;
  it.bar.classList.toggle('indet', running && pct == null);
  it.bar.firstChild.style.width = pct == null ? '' : `${pct}%`;
  if (pct == null) it.bar.removeAttribute('aria-valuenow'); else it.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

await listen('deps-progress', e => update(e.payload));

const errBox = document.getElementById('error');
const retry = document.getElementById('retry');
async function start() {
  errBox.hidden = true;
  retry.hidden = true;
  try {
    await invoke('start');
  } catch (e) {
    errBox.textContent = String(e);
    errBox.hidden = false;
    retry.hidden = false;
    retry.focus();
  }
}
retry.addEventListener('click', start);
start();
