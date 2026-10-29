// Resource profile: what a resource really is (kind), how an agent uses it, and which concrete
// install/integration options exist on this device. Derived from inspected facts (inspect.mjs),
// refined by curated overrides (data/profiles.json). Nothing here is guessed silently: every
// option carries its evidence ("registry" = confirmed in a package registry pointing back at the
// repository, "manifest" = declared by the project, "curated" = reviewed by hand).
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROOT } from './paths.mjs';
import { OS } from './platform.mjs';

export const KIND = {
  plugin: { label: 'Claude Code plugin', icon: 'skills', agent: 'Adds skills, commands, subagents or MCP servers to Claude Code in a single install.' },
  'skill-pack': { label: 'Skill pack', icon: 'skills', agent: 'The agent loads each skill when the task matches its description.' },
  skill: { label: 'Skill', icon: 'skills', agent: 'The agent loads these instructions when the task matches the description.' },
  mcp: { label: 'MCP server', icon: 'mcp', agent: 'The agent calls this server\'s tools directly (Model Context Protocol).' },
  cli: { label: 'Command-line tool', icon: 'terminal', agent: 'The agent runs it in the terminal and reads the output.' },
  app: { label: 'App', icon: 'grid', agent: 'An app for you; the agent drives it when there\'s an integration (MCP, script or API).' },
  library: { label: 'Project library', icon: 'library', agent: 'The agent uses it in your projects\' code; it installs per project, not system-wide.' },
  components: { label: 'UI components', icon: 'grid', agent: 'The agent copies ready-made components into your project (shadcn registry or source).' },
  framework: { label: 'Framework', icon: 'library', agent: 'A foundation for building projects; the agent uses it when creating or changing code.' },
  reference: { label: 'Reference', icon: 'info', agent: 'Reference and inspiration for you and the agent; nothing to install.' },
};

let OVERRIDES = null;
export function overrides() {
  if (!OVERRIDES) { try { OVERRIDES = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'profiles.json'), 'utf8')).resources; } catch { OVERRIDES = {}; } }
  return OVERRIDES;
}
export const reloadOverrides = () => { OVERRIDES = null; };

const REFERENCE_TYPES = new Set(['Documentation', 'Registry', 'Inspiration']);

function mcpOptionsFrom(facts) {
  const out = [];
  for (const p of facts?.mcp_registry?.packages || []) {
    const secrets = (p.env || []).filter(e => e.secret && e.required).map(e => e.name);
    const optional = (p.env || []).filter(e => !e.required).map(e => e.name);
    const reg = String(p.registry || '').toLowerCase();
    if (reg === 'npm' && p.identifier) out.push({ method: 'mcp', transport: 'stdio', command: 'npx', args: ['-y', `${p.identifier}@${p.version || 'latest'}`], secrets, optional_env: optional, requires: ['node'], evidence: 'manifest', label: `npx ${p.identifier}` });
    else if (reg === 'pypi' && p.identifier) out.push({ method: 'mcp', transport: 'stdio', command: 'uvx', args: [p.version ? `${p.identifier}==${p.version}` : p.identifier], secrets, optional_env: optional, requires: ['uv'], evidence: 'manifest', label: `uvx ${p.identifier}` });
    else if (reg === 'oci' && p.identifier) out.push({ method: 'mcp', transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', p.identifier], secrets, optional_env: optional, requires: ['docker'], evidence: 'manifest', label: `docker ${p.identifier}` });
  }
  // Documented `claude mcp add … -- npx|uvx <pkg>` lines, accepted only when that package is confirmed in its registry.
  const npmOk = new Set((facts?.packages?.npm || []).map(x => x.name)), pyOk = new Set((facts?.packages?.pypi || []).map(x => x.name.toLowerCase()));
  for (const line of facts?.readme_commands?.claude_mcp || []) {
    const t = line.split(/\s+/), dash = t.indexOf('--');
    if (dash < 0) continue;
    const [cmd, ...rest] = t.slice(dash + 1);
    const pkg = rest.find(a => !a.startsWith('-'));
    const base = pkg?.replace(/(.)@[^@/]*$/, '$1');
    if (cmd === 'npx' && npmOk.has(base)) out.push({ method: 'mcp', transport: 'stdio', command: 'npx', args: ['-y', pkg], secrets: [], requires: ['node'], evidence: 'documented', label: `npx ${base}` });
    if (cmd === 'uvx' && base && pyOk.has(base.toLowerCase())) out.push({ method: 'mcp', transport: 'stdio', command: 'uvx', args: [pkg], secrets: [], requires: ['uv'], evidence: 'documented', label: `uvx ${base}` });
  }
  // An MCP server published on npm with an executable runs through npx.
  if (!out.length) for (const x of facts?.packages?.npm || []) if (x.bin?.length && /mcp/i.test(x.name)) out.push({ method: 'mcp', transport: 'stdio', command: 'npx', args: ['-y', `${x.name}@${x.version}`], secrets: [], requires: ['node'], evidence: 'registry', label: `npx ${x.name}` });
  for (const r of facts?.mcp_registry?.remotes || []) if (r.url) out.push({ method: 'mcp', transport: /sse/i.test(r.type) ? 'sse' : 'http', url: r.url, secrets: [], requires: [], evidence: 'manifest', label: `remote ${new URL(r.url).host}` });
  return out;
}

function packageOptions(facts) {
  const out = [];
  const pk = facts?.packages || {};
  const npmBin = (pk.npm || []).find(p => p.bin?.length);
  if (npmBin) out.push({ method: 'package', manager: 'npm', name: npmBin.name, version: npmBin.version, bins: npmBin.bin, requires: ['node'], evidence: 'registry', provenance: Boolean(npmBin.provenance), label: `npm ${npmBin.name}` });
  const py = (pk.pypi || [])[0];
  if (py && (facts.pyproject?.scripts?.length || facts.readme_commands?.pipx || facts.readme_commands?.uv || facts.readme_commands?.uvx)) {
    out.push({ method: 'package', manager: 'uv', name: py.name, version: py.version, bins: facts.pyproject?.scripts || [], requires: ['uv'], evidence: 'registry', label: `uv tool ${py.name}` });
    out.push({ method: 'package', manager: 'pipx', name: py.name, version: py.version, bins: facts.pyproject?.scripts || [], requires: ['pipx'], evidence: 'registry', label: `pipx ${py.name}` });
  }
  const crate = (pk.crates || [])[0];
  if (crate && (facts.cargo?.bins?.length || facts.readme_commands?.cargo)) out.push({ method: 'package', manager: 'cargo', name: crate.name, version: crate.version, requires: ['cargo'], evidence: 'registry', label: `cargo ${crate.name}` });
  for (const b of pk.brew || []) out.push({ method: 'package', manager: 'brew', name: b.name, version: b.version, requires: ['brew'], evidence: 'registry', label: `brew ${b.name}`, os: ['macos', 'linux'] });
  for (const c of pk.cask || []) out.push({ method: 'package', manager: 'cask', name: c.name, version: c.version, requires: ['brew'], evidence: 'registry', label: `brew --cask ${c.name}`, os: ['macos'] });
  return out;
}

export function deriveKind(r, facts, ov = {}) {
  if (ov.kind) return ov.kind;
  if (REFERENCE_TYPES.has(r.type)) return 'reference';
  if (!facts || facts.source === 'web') return r.type === 'Library' ? 'components' : r.type === 'Skill' ? 'skill' : r.type === 'Tool' ? 'app' : r.type === 'Framework' ? 'framework' : 'reference';
  const L = facts.layout || {};
  const productSkills = L.skills_product ?? L.skills ?? 0;
  if (L.marketplace || L.plugin) return 'plugin';
  if (facts.mcp_registry || r.type === 'MCP' || (/(^|[-_])mcp($|[-_])/i.test(facts.full_name) && facts.mentions?.mcp)) return 'mcp';
  if (productSkills >= 2) return 'skill-pack';
  if (productSkills === 1 && !facts.packages) return 'skill';
  const pk = facts.packages || {};
  if (pk.cask) return 'app';
  if ((pk.npm || []).some(p => p.bin?.length) || facts.pyproject?.scripts?.length || facts.cargo?.bins?.length || pk.brew) return 'cli';
  if (r.type === 'Framework') return 'framework';
  if (pk.npm || pk.pypi || pk.crates || r.type === 'Library') return 'library';
  if (r.type === 'Skill') return L.skills ? 'skill' : 'reference';
  if (r.type === 'Tool') return facts.latest_release?.assets?.length ? 'app' : 'cli';
  return 'reference';
}

// requires: runtime/manager ids -> availability on this device (from the last scan's managers).
export function profile(r, facts, { managers = {}, runtimes = {}, user = {} } = {}) {
  const ov = overrides()[r.id] || {};
  const kind = user.kind || deriveKind(r, facts, ov);
  const k = KIND[kind];
  const options = [];
  const full = facts?.full_name || r.gh_full_name;
  if (kind === 'plugin' && full) {
    const mk = facts?.marketplace;
    const plugins = mk?.plugins?.length ? mk.plugins : facts?.plugin ? [facts.plugin] : [];
    for (const p of plugins.slice(0, 12)) options.push({ method: 'plugin', marketplace: full, marketplace_name: mk?.name || null, plugin: p.name, description: p.description || null, requires: ['claude'], evidence: 'manifest', label: plugins.length > 1 ? `Plugin ${p.name}` : 'Claude Code plugin' });
  }
  if ((kind === 'skill' || kind === 'skill-pack' || kind === 'plugin') && full && facts?.skills?.length) {
    for (const s of facts.skills.filter(x => !x.internal || r.type === 'Skill').slice(0, 40)) {
      if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name)) options.push({ method: 'skill', repo: full, path: s.path, name: s.name, description: s.description, has_scripts: s.has_scripts, requires: [], evidence: 'manifest', label: `Skill ${s.name}` });
    }
  }
  if (kind === 'mcp' || facts?.mcp_registry || facts?.readme_commands?.claude_mcp || (facts?.packages?.npm || []).some(x => /mcp/i.test(x.name))) options.push(...mcpOptionsFrom(facts));
  // Libraries: the agent writes better code with current docs; one shared server serves all of them.
  if (['library', 'framework'].includes(kind)) options.push({ method: 'mcp', transport: 'stdio', name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp@4.4.4'], requires: ['node'], label: 'Give the agent up-to-date docs (Context7)', evidence: 'curated', shared: true });
  if (['cli', 'app', 'mcp', 'plugin', 'framework'].includes(kind)) options.push(...packageOptions(facts));
  for (const o of ov.install || []) options.push({ ...o, evidence: 'curated', requires: o.requires || (o.manager ? [o.manager === 'cask' ? 'brew' : o.manager] : []) });
  // One option per target: curated entries win over derived duplicates.
  const seenOpt = new Map();
  for (const o of options) { const k = optionId(o); if (!seenOpt.has(k) || o.evidence === 'curated') seenOpt.set(k, o); }
  options.length = 0;
  options.push(...seenOpt.values());
  // An MCP server launched with uvx/npx needs no separate package install of the same thing.
  if (kind === 'mcp') {
    const launched = new Set(options.filter(o => o.method === 'mcp').flatMap(o => (o.args || []).map(a => a.replace(/(==|@)[^/]*$/, '').toLowerCase())));
    for (let i = options.length - 1; i >= 0; i--) if (options[i].method === 'package' && launched.has(options[i].name.toLowerCase())) options.splice(i, 1);
  }
  // Platform & prerequisites for this device.
  for (const o of options) {
    const osOk = !o.os || o.os.includes(OS);
    const missing = (o.requires || []).filter(req => !(managers[req]?.available || runtimes[req]));
    o.supported_here = osOk;
    o.missing = osOk ? missing : [];
    o.ready = osOk && !missing.length;
  }
  const project = [];
  const projectKind = ['library', 'framework', 'components'].includes(kind);
  for (const p of facts?.packages?.npm || []) if (projectKind && !ov.project) project.push({ manager: 'npm', command: `npm install ${p.name}`, version: p.version });
  for (const p of facts?.packages?.pypi || []) if (projectKind && !ov.project) project.push({ manager: 'pip', command: `pip install ${p.name}`, version: p.version });
  if (!ov.project) for (const c of facts?.readme_commands?.shadcn || []) project.push({ manager: 'shadcn', command: `npx shadcn@latest add ${c}` });
  for (const c of ov.project || []) project.push(c);
  if (user.command) project.unshift({ manager: 'custom', command: user.command, mine: true });
  const agentUse = ov.agent_use || (kind === 'cli' && facts?.mentions?.json_output ? `${k.agent} It has JSON output, which makes results easy for the agent to read.` : k.agent);
  return {
    kind, kind_label: k.label, icon: k.icon, agent_use: agentUse,
    installable: options.length > 0, options: rank(options, kind), project_use: dedupeBy(project, 'command').slice(0, 6),
    docs: ov.docs || r.official_docs || facts?.homepage || (full ? `https://github.com/${full}#readme` : r.canonical_url),
    related: ov.related || [], notes: ov.notes || null,
    secrets: [...new Set(options.flatMap(o => o.secrets || []))],
    facts_at: facts?.inspected_at || null,
  };
}

const METHOD_ORDER = { plugin: 0, mcp: 1, skill: 2, package: 3, download: 9 };
const MANAGER_ORDER = { cask: 0, brew: 1, winget: 1, flatpak: 1, uv: 2, npm: 3, pipx: 4, cargo: 5, scoop: 6 };
function rank(options, kind) {
  return options.sort((a, b) => (b.ready - a.ready) || (b.supported_here - a.supported_here) || ((METHOD_ORDER[a.method] ?? 5) - (METHOD_ORDER[b.method] ?? 5)) || ((MANAGER_ORDER[a.manager] ?? 9) - (MANAGER_ORDER[b.manager] ?? 9)))
    .map((o, i) => ({ ...o, id: optionId(o), primary: i === 0 }));
}
export const optionId = o => [o.method, o.manager || o.transport || '', o.plugin || o.name || o.path || o.url || (o.args || []).join(' ')].join(':');
function dedupeBy(list, key) { const s = new Set(); return list.filter(x => (s.has(x[key]) ? false : s.add(x[key]))); }
