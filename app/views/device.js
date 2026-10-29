// This computer, at a glance: the system, the base tools installers and agents run on, and the package
// managers CURI installs through. Shown at the top of Library › Installed › This computer.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const RT = [['node', 'Node.js'], ['python3', 'Python'], ['git', 'Git'], ['uv', 'uv'], ['homebrew', 'Homebrew'], ['cargo', 'Rust'], ['docker', 'Docker'], ['go', 'Go'], ['java', 'Java'], ['claude', 'Claude Code'], ['xcode', 'Xcode']];
const SUPPORT = { tested: 'Tested on this system', 'implemented-untested': 'Implemented, not yet tested here' };
// "MCP servers" with one item reads "1 MCP server".
export const noun = (label, n) => { const l = label.replace(/ synced.*/, ''); const w = /^[A-Z]{2,}/.test(l) ? l : l.toLowerCase(); return n === 1 ? w.replace(/s$/, '').replace(/s( \(|$)/, '$1') : w; };

export function computerOverview(d) {
  const r = d?.scan;
  if (!r) return null;
  const managers = Object.entries(r.managers || {});
  const rts = RT.filter(([k]) => k in (r.runtimes || {}));
  const li = (on, name, value) => h('div', { class: `dv-li ${on ? '' : 'off'}` }, h('span', { class: `dot ${on ? 'good' : ''}`, 'aria-hidden': 'true' }), h('span', { class: 'n' }, name), h('span', { class: 'v mono' }, value));
  return h('section', { class: 'dv-computer' },
    h('div', { class: 'dv-sys' },
      h('span', { class: 'ic' }, icon('device')),
      h('div', null, h('strong', null, d.label), h('span', null, `${d.arch} · ${r.device?.release || ''}`)),
      h('dl', null,
        h('div', null, h('dt', null, 'Support'), h('dd', null, SUPPORT[d.support] || d.support)),
        h('div', null, h('dt', null, 'Keys and tokens'), h('dd', null, d.credential_store)))),
    h('div', { class: 'dv-cols' },
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Base tools'), h('span', { class: 'meta' }, 'what installers and agents run on')),
        h('div', { class: 'dv-list' }, rts.map(([k, l]) => li(Boolean(r.runtimes[k]), l, r.runtimes[k] || 'not found')))),
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Package managers'), h('span', { class: 'meta' }, 'how CURI installs tools')),
        h('div', { class: 'dv-list' }, managers.map(([, m]) => li(m.available, m.label, m.available ? (m.system ? 'system, read-only' : `${m.count ?? 0} package${m.count === 1 ? '' : 's'}`) : 'not installed'))))));
}
