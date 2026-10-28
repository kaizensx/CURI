// This device: the operating system, the AI agents found on it and what each one has (MCP servers,
// skills, plugins, claude.ai account skills), runtimes and package managers, and which catalogue
// resources are present. Read-only inventory; changes happen through Library actions.
import { h, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, notice } from '../lib/ui.js';
import { go } from '../app.js';
import { runOperation } from './control.js';
import { stateChip, kindTile } from './common.js';

const RT = [['node', 'Node.js'], ['python3', 'Python'], ['git', 'Git'], ['uv', 'uv'], ['homebrew', 'Homebrew'], ['cargo', 'Rust'], ['docker', 'Docker'], ['go', 'Go'], ['claude', 'Claude Code'], ['xcode', 'Xcode']];
const SUPPORT = { tested: 'tested on this system', 'implemented-untested': 'implemented, not yet tested on this system' };

function agentCard(a) {
  if (!a.present) return h('article', { class: 'agent absent' }, h('header', null, icon('agent'), h('strong', null, a.label), h('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '12px' } }, 'not found')));
  const group = (title, items, render) => (items.length ? h('details', null, h('summary', null, `${title} · ${items.length}`, h('span', { class: 'muted' }, ` ${items.filter(i => i.matched).length} in catalogue`)), h('div', { class: 'items' }, items.map(render))) : null);
  const item = (name, tag, matched, extra) => h('div', { class: 'it' }, h('span', { class: 'n mono', title: name }, name), extra, h('span', { class: `tag ${matched ? 'cat' : ''}` }, matched ? 'in catalogue' : tag));
  return h('article', { class: 'agent' },
    h('header', null, icon('agent'), h('strong', null, a.label), a.writable ? h('span', { class: 'state installed', style: { marginLeft: 'auto' }, title: 'CURI installs and removes through the agent itself' }, 'Managed') : h('span', { class: 'state reference', style: { marginLeft: 'auto' }, title: 'CURI reads it; changes happen in the agent itself' }, 'Read-only')),
    h('div', { class: 'counts' },
      h('span', null, h('b', null, a.counts.mcp), 'MCP'), h('span', null, h('b', null, a.counts.skills), 'skills'), h('span', null, h('b', null, a.counts.plugins), 'plugins'),
      a.counts.account_skills ? h('span', null, h('b', null, a.counts.account_skills), 'from account') : null),
    group('MCP servers', a.mcp, m => item(m.name, m.scope, m.matched, m.enabled === false ? h('span', { class: 'tag' }, 'disabled') : null)),
    group('Skills', a.skills, s => item(s.name, s.managed_by === 'curi' ? 'CURI' : s.scope, s.matched)),
    group('Plugins', a.plugins, p => item(p.id, p.scope === 'synced' ? 'account' : p.enabled ? 'enabled' : 'disabled', p.matched)),
    group('claude.ai account skills', a.account_skills, s => item(s.name, s.enabled ? s.origin || 'enabled' : 'disabled', s.matched)),
    h('footer', null, h('span', { style: { flex: 1 } }, a.manage?.how || ''),
      a.config ? btn('', () => api('revealAgentConfig', { agent: a.id }), { size: 'sm', kind: 'ghost', iconName: 'external', title: 'Show the configuration file' }) : null,
      a.manage?.url ? btn('', () => api('openExternal', { url: a.manage.url }), { size: 'sm', kind: 'ghost', iconName: 'cloud', title: 'Open account settings' }) : null));
}

export async function device() {
  const d = await api('device');
  const r = d.scan;
  const scan = btn('Scan now', () => runOperation('system.scan', {}, 'Detect what\'s installed'), { kind: 'primary', iconName: 'refresh' });
  const head = h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'This device'),
    h('p', null, `${d.label} · ${d.arch} · support ${SUPPORT[d.support] || d.support}. Credentials in the ${d.credential_store}.${r ? ` Last scan ${relTime(r.scanned_at)}.` : ''}`)), h('div', { class: 'actions' }, scan));
  if (!r?.agents) return h('div', { class: 'page' }, head, empty('device', 'No full scan yet', 'CURI reads, without changing anything, your apps, command-line tools, package managers and each agent\'s configuration (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf, VS Code), and matches it all to the catalogue.', scan));
  const managers = Object.entries(r.managers || {});
  const present = r.agents.filter(a => a.present);
  return h('div', { class: 'page' }, head,
    h('div', { class: 'sec' }, h('h2', null, 'Agents'), h('span', { class: 'meta' }, `${present.length} found`)),
    h('div', { class: 'agents' }, [...present, ...r.agents.filter(a => !a.present)].map(agentCard)),
    h('div', { class: 'sec' }, h('h2', null, 'From the catalogue, present here'), h('span', { class: 'meta' }, `${r.matched.length} resources`), h('span', { class: 'end' }, btn('Open in Library', () => go('library?view=here'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
    r.matched.length ? h('div', { class: 'rlist' }, r.matched.map(m => {
      const el = h('div', { class: 'rrow', tabindex: '0', role: 'link' }, kindTile(m.kind, true),
        h('div', { class: 'rmain' }, h('div', { class: 'rname' }, h('strong', null, m.name)), h('div', { class: 'rdesc' }, m.found.slice(0, 4).map(f => `${f.agent_label || f.type} · ${f.name}${f.version ? ` ${f.version}` : ''}`).join('   '))),
        h('div', { class: 'rmeta' }, stateChip(m.state)), h('div', { class: 'ract' }));
      const open = () => go(`resource/${encodeURIComponent(m.id)}`);
      el.addEventListener('click', open); el.addEventListener('keydown', e => e.key === 'Enter' && open());
      return el;
    })) : empty('search', 'No catalogue resources found'),
    h('div', { class: 'sec' }, h('h2', null, 'Base tools')),
    h('div', { class: 'rt' }, RT.filter(([k]) => k in (r.runtimes || {})).map(([k, l]) => h('div', { class: r.runtimes[k] ? '' : 'off' }, h('span', { class: 'micro' }, l), h('span', { class: 'v' }, r.runtimes[k] || 'not found')))),
    h('div', { class: 'sec' }, h('h2', null, 'Package managers')),
    h('div', { class: 'rt' }, managers.map(([k, m]) => h('div', { class: m.available ? '' : 'off' }, h('span', { class: 'micro' }, m.label), h('span', { class: 'v' }, m.available ? (m.system ? 'system (read-only)' : `${m.count ?? '—'} pacotes`) : 'not installed')))),
    r.not_in_catalog?.apps?.length ? [h('div', { class: 'sec' }, h('h2', null, 'Apps not in the catalogue'), h('span', { class: 'meta' }, `${r.not_in_catalog.apps.length}`)),
      h('div', { class: 'box pad' }, h('div', { class: 'capchips' }, r.not_in_catalog.apps.map(a => h('span', { class: 'capchip' }, a))))] : null,
    h('div', { style: { marginTop: '22px' } }, notice('info', 'Libraries used inside projects (React, Zod, Three.js…) aren\'t detected system-wide: they belong to each project. claude.ai account skills and connectors are read from the copy Claude Desktop syncs; you manage them on claude.ai.')));
}
