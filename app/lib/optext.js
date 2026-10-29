// Operations in plain words: "Installed taste-skill in Claude Code" instead of "plugin.install · plugin:taste-skill".
// Each kind has what it does (to start a sentence) and what it did; the status picks which one is shown.

const clean = s => String(s || '').replace(/^(plugin|skill|mcp|gh|package):/, '').replace(/@.*$/, '').replace(/^.*\//, '');

const KINDS = {
  'plugin.install': p => ['Install', 'Installed', `${clean(p.plugin)}`, 'in Claude Code', 'layers'],
  'plugin.update': p => ['Update', 'Updated', clean(p.plugin), 'in Claude Code', 'layers'],
  'plugin.uninstall': p => ['Uninstall', 'Uninstalled', clean(p.plugin), 'from Claude Code', 'trash'],
  'plugin.enable': p => ['Turn on', 'Turned on', clean(p.plugin), 'in Claude Code', 'layers'],
  'plugin.disable': p => ['Turn off', 'Turned off', clean(p.plugin), 'in Claude Code', 'layers'],
  'skill.install': p => (p.update ? ['Update', 'Updated'] : ['Install', 'Installed']).concat([`the ${p.name || clean(p.path)} skill`, '', 'skills']),
  'skill.remove': p => ['Remove', 'Removed', `the ${p.name} skill`, '', 'trash'],
  'mcp.add': p => ['Add', 'Added', `the ${p.name || clean(p.id)} MCP server`, 'to Claude Code', 'mcp'],
  'mcp.enable': p => (p.repair ? ['Repair', 'Repaired'] : ['Turn on', 'Turned on']).concat([`the ${p.name} MCP server`, '', 'mcp']),
  'mcp.disable': p => ['Turn off', 'Turned off', `the ${p.name} MCP server`, '', 'mcp'],
  'mcp.remove': p => ['Remove', 'Removed', `the ${p.name} MCP server`, 'from Claude Code', 'trash'],
  'mcp.check': () => ['Test', 'Tested', 'the MCP connections', '', 'activity'],
  'package.install': p => ['Install', 'Installed', p.name, `with ${p.manager}`, 'terminal'],
  'package.upgrade': p => ['Update', 'Updated', p.name, `with ${p.manager}`, 'terminal'],
  'package.remove': p => ['Uninstall', 'Uninstalled', p.name, `with ${p.manager}`, 'trash'],
  'agent.install': () => ['Set up', 'Set up', 'the background service', 'that keeps things current', 'clock'],
  'system.scan': () => ['Look at', 'Looked at', 'what is installed', 'on this computer and in your agents', 'device'],
  'sources.verify': p => ['Check', 'Checked', `that ${p.limit || 'the'} catalogue sources`, 'are still online', 'check'],
  'resource.inspect': p => ['Refresh', 'Refreshed', `the details of ${clean(p.id)}`, '', 'refresh'],
  'discover': p => (p.mode === 'task' ? ['Search', 'Searched', `GitHub for "${p.intent}"`, '', 'radar'] : ['Look', 'Looked', 'for new projects on GitHub', '', 'radar']),
  'discover.inspect': () => ['Inspect', 'Inspected', 'new projects found on GitHub', '', 'search'],
  'github.stars': () => ['Review', 'Reviewed', 'your GitHub stars', '', 'star'],
  'verify.run': () => ['Run', 'Ran', "CURI's own checks", '', 'shield'],
};

export function describeOp(o) {
  const p = o.params || {};
  const f = KINDS[o.kind];
  const [verb, past, what, where, glyph] = f ? f(p) : [o.kind, o.kind, o.resource || '', '', 'activity'];
  const tail = [what, where].filter(Boolean).join(' ');
  const title = ['verified', 'completed'].includes(o.status) ? `${past} ${tail}`
    : o.status === 'failed' ? `Couldn't ${verb.toLowerCase()} ${tail}`
    : o.status === 'awaiting_approval' ? `${verb} ${tail}?`
    : ['cancelled', 'interrupted'].includes(o.status) ? `${verb} ${tail} (stopped)`
    : `${verb} ${tail}…`;
  const resourceId = p.resource_id || (String(p.id || '').startsWith('gh:') ? p.id : null);
  return { title, icon: glyph, resourceId, who: String(o.actor).startsWith('user') ? 'You' : 'CURI on its own' };
}
