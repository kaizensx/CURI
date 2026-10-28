// This device: the computer, the agents on it and the base tools they rely on, at a glance. The full
// list of what each agent holds lives in Library › Installed; every number here opens it.
import { h, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, notice } from '../lib/ui.js';
import { go } from '../app.js';
import { runOperation } from './control.js';

const RT = [['node', 'Node.js'], ['python3', 'Python'], ['git', 'Git'], ['uv', 'uv'], ['homebrew', 'Homebrew'], ['cargo', 'Rust'], ['docker', 'Docker'], ['go', 'Go'], ['java', 'Java'], ['claude', 'Claude Code'], ['xcode', 'Xcode']];
const SUPPORT = { tested: 'Tested on this system', 'implemented-untested': 'Implemented, not yet tested here' };
const PLACE_ICON = { account: 'cloud', agent: 'agent', computer: 'device' };
// "MCP servers" with one item reads "1 MCP server".
export const noun = (label, n) => { const l = label.replace(/ synced.*/, ''); const w = /^[A-Z]{2,}/.test(l) ? l : l.toLowerCase(); return n === 1 ? w.replace(/s$/, '').replace(/s( \(|$)/, '$1') : w; };
const openPlace = id => go(`library?tab=installed&place=${encodeURIComponent(id)}`);

function tile(label, value, sub, onclick) {
  const el = h(onclick ? 'button' : 'div', { class: 'dv-stat', type: onclick ? 'button' : null }, h('span', { class: 'v num' }, String(value)), h('span', { class: 'l' }, label), sub ? h('span', { class: 's' }, sub) : null);
  if (onclick) el.addEventListener('click', onclick);
  return el;
}

function placeCard(p, agent) {
  const parts = p.groups.map(g => h('span', null, h('b', { class: 'num' }, String(g.items.length)), ` ${noun(g.label, g.items.length)}`));
  const managed = p.kind === 'account' ? ['account', 'Synced from claude.ai'] : p.kind === 'computer' ? ['installed', 'Apps and packages'] : agent?.writable ? ['installed', 'CURI can install here'] : ['reference', 'CURI reads it'];
  const el = h('button', { type: 'button', class: `dv-agent ${p.kind}` },
    h('div', { class: 'top' }, h('span', { class: 'ic' }, icon(PLACE_ICON[p.kind] || 'agent')), h('span', { class: 'nm' }, h('strong', null, p.label), h('span', { class: `st ${managed[0]}` }, managed[1]))),
    h('div', { class: 'big num' }, String(p.count), h('span', null, p.count === 1 ? ' thing installed' : ' things installed')),
    h('div', { class: 'parts' }, parts.length ? parts : h('span', null, 'Nothing installed yet')),
    h('div', { class: 'go' }, 'See what\'s here', icon('chevron', 'sm')));
  el.addEventListener('click', () => openPlace(p.id));
  return el;
}

export async function device() {
  const [d, inv] = await Promise.all([api('device'), api('installed')]);
  const r = d.scan;
  const scan = btn('Check again', () => runOperation('system.scan', {}, 'Look at this device again'), { kind: 'primary', iconName: 'refresh' });
  const head = h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'This device'),
    h('p', null, r ? `What's on this computer and in your agents. Checked ${relTime(r.scanned_at)}; nothing is changed by looking.` : 'What\'s on this computer and in your agents.')), h('div', { class: 'actions' }, scan));
  if (!r?.agents) return h('div', { class: 'page' }, head, empty('device', 'CURI hasn\'t looked at this device yet', 'It reads, without changing anything, your apps, command-line tools, package managers and each agent\'s configuration (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf, VS Code).', scan));

  const agents = new Map(r.agents.map(a => [a.id, a]));
  const absent = r.agents.filter(a => !a.present).map(a => a.label);
  const total = inv.places.reduce((n, p) => n + p.count, 0);
  const managers = Object.entries(r.managers || {});
  const rts = RT.filter(([k]) => k in (r.runtimes || {}));
  const rtFound = rts.filter(([k]) => r.runtimes[k]).length;

  return h('div', { class: 'page dv' }, head,
    h('section', { class: 'dv-hero' },
      h('div', { class: 'dv-sys' },
        h('span', { class: 'ic' }, icon('device')),
        h('div', null, h('strong', null, d.label), h('span', null, `${d.arch} · ${r.device?.release || ''}`)),
        h('dl', null,
          h('div', null, h('dt', null, 'Support'), h('dd', null, SUPPORT[d.support] || d.support)),
          h('div', null, h('dt', null, 'Keys and tokens'), h('dd', null, d.credential_store)))),
      h('div', { class: 'dv-stats' },
        tile('agents found', r.agents.filter(a => a.present).length, absent.length ? `${absent.length} not installed` : null),
        tile('things installed', total, 'across every place', () => openPlace('')),
        tile('from the catalogue', r.matched.length, 'recognised by CURI', () => go('library?tab=catalogue&view=here')),
        tile('base tools', `${rtFound}/${rts.length}`, 'runtimes found'))),

    h('div', { class: 'sec' }, h('h2', null, 'Where things live'), h('span', { class: 'meta' }, 'each agent keeps its own list')),
    h('div', { class: 'dv-agents' }, inv.places.map(p => placeCard(p, agents.get(p.id)))),
    absent.length ? h('p', { class: 'dv-absent' }, icon('info', 'sm'), `Not on this computer: ${absent.join(', ')}. CURI picks them up the next time it looks, once they're installed.`) : null,

    h('div', { class: 'dv-cols' },
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Base tools'), h('span', { class: 'meta' }, 'what installers and agents run on')),
        h('div', { class: 'dv-list' }, rts.map(([k, l]) => h('div', { class: `dv-li ${r.runtimes[k] ? '' : 'off'}` },
          h('span', { class: `dot ${r.runtimes[k] ? 'good' : ''}`, 'aria-hidden': 'true' }), h('span', { class: 'n' }, l), h('span', { class: 'v mono' }, r.runtimes[k] || 'not found'))))),
      h('section', null,
        h('div', { class: 'sec' }, h('h2', null, 'Package managers'), h('span', { class: 'meta' }, 'how CURI installs tools')),
        h('div', { class: 'dv-list' }, managers.map(([k, m]) => {
          const el = h(m.available && m.count ? 'button' : 'div', { class: `dv-li ${m.available ? '' : 'off'}`, type: m.available && m.count ? 'button' : null },
            h('span', { class: `dot ${m.available ? 'good' : ''}`, 'aria-hidden': 'true' }), h('span', { class: 'n' }, m.label),
            h('span', { class: 'v' }, m.available ? (m.system ? 'system, read-only' : `${m.count ?? 0} package${m.count === 1 ? '' : 's'}`) : 'not installed'),
            m.available && m.count ? icon('chevron', 'sm') : null);
          if (m.available && m.count) el.addEventListener('click', () => openPlace('computer'));
          return el;
        })))),
    h('div', { style: { marginTop: '22px' } }, notice('info', 'Libraries used inside projects (React, Zod, Three.js…) belong to each project, so they aren\'t listed here. Skills and plugins from your claude.ai account are read from the copy Claude Desktop keeps; you change them on claude.ai.')));
}
