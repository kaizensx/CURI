// What is installed, grouped by where it lives: each agent (Claude Code, the claude.ai account, Claude
// Desktop, Codex, Cursor…) and this computer itself. Built from the last device scan, so it covers
// everything that's there, not just what the catalogue knows about; catalogue matches link back to it.
import { lastScan } from './detect.mjs';

const ACCOUNT_URL = 'https://claude.ai/settings/capabilities';
const PKG_LABEL = { brew: 'Homebrew', cask: 'Homebrew Cask', npm: 'npm (global)', uv: 'uv tools', pipx: 'pipx', cargo: 'Cargo', winget: 'WinGet', scoop: 'Scoop', flatpak: 'Flatpak' };
const PLACE_NOTE = {
  'claude-code': 'Plugins, MCP servers and skills in your Claude Code configuration.',
  'claude-account': 'Skills and plugins that come with your claude.ai account. They follow you to every device and to Claude Desktop.',
  'claude-desktop': 'MCP servers in Claude Desktop\'s own configuration.',
  codex: 'Skills and MCP servers in Codex (~/.codex).',
  computer: 'Apps and command-line packages on this computer.',
};

export function inventory(db) {
  const scan = lastScan(db);
  if (!scan) return { scanned_at: null, places: [] };
  // "agent|type|name" -> catalogue resource, from the scan's own matches.
  const link = new Map();
  for (const m of scan.matched || []) for (const f of m.found) link.set(`${f.agent || 'system'}|${f.type}|${f.name}`, { id: m.id, name: m.name });
  const res = (agent, type, name) => link.get(`${agent}|${type}|${name}`) || null;
  const places = [];
  const place = (id, label, extra) => { const p = { id, label, note: PLACE_NOTE[id] || null, groups: [], ...extra }; places.push(p); return p; };
  const group = (p, id, label, items) => { if (items.length) p.groups.push({ id, label, items }); };

  const account = place('claude-account', 'claude.ai account', { kind: 'account', manage_url: ACCOUNT_URL });
  for (const a of scan.agents || []) {
    const synced = (a.plugins || []).filter(pl => pl.scope === 'synced' || pl.managed_by === 'account');
    if (a.account_skills?.length) group(account, 'skills', 'Skills', a.account_skills.map(s => ({
      name: s.name, type: 'account-skill', description: s.description, enabled: s.enabled, origin: s.origin, resource: res('claude-account', 'account-skill', s.name),
      actions: [{ type: 'open', label: 'Manage on claude.ai', url: ACCOUNT_URL }] })));
    if (synced.length) group(account, 'plugins', 'Plugins synced to Claude Code', synced.map(pl => ({
      name: pl.name || pl.id, type: 'plugin', version: pl.version, enabled: pl.enabled, origin: 'claude.ai account', resource: res(a.id, 'plugin', pl.id),
      actions: [{ type: 'open', label: 'Manage on claude.ai', url: ACCOUNT_URL }] })));

    const p = place(a.id, a.label, { kind: 'agent', present: a.present, config: a.config, manage: a.manage?.how || null, notes: a.notes || [] });
    const local = (a.plugins || []).filter(pl => !synced.includes(pl));
    group(p, 'plugins', 'Plugins', local.map(pl => ({
      name: pl.id, type: 'plugin', version: pl.version, enabled: pl.enabled, origin: pl.marketplace, scope: pl.scope, resource: res(a.id, 'plugin', pl.id),
      actions: a.id === 'claude-code' ? [
        { type: 'op', label: pl.enabled === false ? 'Enable' : 'Disable', op: { kind: pl.enabled === false ? 'plugin.enable' : 'plugin.disable', params: { plugin: pl.id } } },
        { type: 'op', label: 'Uninstall', danger: true, op: { kind: 'plugin.uninstall', params: { plugin: pl.id } } }] : [] })));
    group(p, 'mcp', 'MCP servers', (a.mcp || []).map(m => ({
      name: m.name, type: 'mcp', enabled: m.enabled, detail: m.url || m.line, scope: m.scope, resource: res(a.id, 'mcp', m.name),
      actions: a.id === 'claude-code' && m.name !== 'curi' && ['user', 'local', 'project'].includes(m.scope || 'user')
        ? [{ type: 'op', label: 'Remove', danger: true, op: { kind: 'mcp.remove', params: { name: m.name, scope: m.scope || 'user' } } }] : [] })));
    group(p, 'skills', 'Skills', (a.skills || []).map(s => ({
      name: s.name, type: 'skill', description: s.description, scope: s.scope, origin: s.managed_by === 'curi' ? 'installed by CURI' : s.repo || null, resource: res(a.id, 'skill', s.name), actions: [] })));
  }

  const pc = place('computer', 'This computer', { kind: 'computer', os: scan.device?.label });
  const appLinks = new Map([...link].filter(([k]) => k.startsWith('system|app|')).map(([k, v]) => [k.split('|')[2], v]));
  group(pc, 'apps', 'Apps', (scan.apps || []).filter(n => !n.includes('/')).map(n => ({ name: n, type: 'app', resource: appLinks.get(n) || null, actions: [] })));
  for (const [mgr, list] of Object.entries(scan.packages || {})) group(pc, `pkg-${mgr}`, PKG_LABEL[mgr] || mgr, list.map(([n, v]) => ({
    name: n, type: mgr, version: v, resource: res('system', mgr, n),
    actions: mgr === 'npm' && n === 'npm' ? [] : [
      { type: 'op', label: 'Update', op: { kind: 'package.upgrade', params: { manager: mgr, name: n } } },
      { type: 'op', label: 'Remove', danger: true, op: { kind: 'package.remove', params: { manager: mgr, name: n } } }] })));

  account.groups.sort((a, b) => (a.id === 'skills' ? -1 : 0) - (b.id === 'skills' ? -1 : 0));
  for (const p of places) p.count = p.groups.reduce((n, g) => n + g.items.length, 0);
  return { scanned_at: scan.scanned_at, places: places.filter(p => p.count || (p.kind === 'agent' && p.present)) };
}
