// Resource inspection: reads what a project actually ships (file tree, manifests, README install
// instructions) and confirms packages in their public registries. Read-only; never executes code.
// The result ("facts") drives the resource kind, the actions offered, and comparisons.
import { ghFetch, webCheck } from './github.mjs';

const UA = 'CURI/3.2 (+local-first resource registry)';
const RAW = (full, ref, p) => `https://raw.githubusercontent.com/${full}/${ref}/${p}`;

async function getText(url, { timeoutMs = 15000, max = 400000 } = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!r.ok) return { status: r.status, text: null };
    const t = await r.text();
    return { status: r.status, text: t.slice(0, max), url: r.url };
  } catch (e) { return { status: 0, text: null, error: e.message }; }
}
async function getJson(url, opts) {
  const r = await getText(url, opts);
  if (!r.text) return { status: r.status, json: null };
  try { return { status: r.status, json: JSON.parse(r.text) }; } catch { return { status: r.status, json: null }; }
}

// --- manifest parsing (no TOML dependency: only the few keys we need) ---
export function tomlValue(text, section, key) {
  const lines = text.split('\n');
  let cur = '';
  for (const l of lines) {
    const s = l.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (s) { cur = s[1].trim(); continue; }
    if (cur !== section) continue;
    const m = l.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`));
    if (m) return m[1];
  }
  return null;
}
export function tomlTableKeys(text, section) {
  const out = [];
  let cur = '';
  for (const l of text.split('\n')) {
    const s = l.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (s) { cur = s[1].trim(); continue; }
    if (cur === section) { const m = l.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=/); if (m) out.push(m[1]); }
  }
  return out;
}

// Install commands people actually document. Each match is evidence, not an instruction we run.
const CMD_PATTERNS = [
  ['brew', /\bbrew install\s+(?:--cask\s+)?([A-Za-z0-9@._/+-]+)/g],
  ['cask', /\bbrew install\s+--cask\s+([A-Za-z0-9@._/+-]+)/g],
  ['npm', /\bnpm (?:i|install)\s+(?:-g|--global)\s+([@A-Za-z0-9._/-]+)/g],
  ['npx', /\bnpx\s+(?:-y\s+|--yes\s+)?([@A-Za-z0-9._/-]+(?:@[A-Za-z0-9._-]+)?)/g],
  ['pip', /\bpip3? install\s+(?:-U\s+|--upgrade\s+)?([A-Za-z0-9._\[\]-]+)/g],
  ['pipx', /\bpipx install\s+([A-Za-z0-9._\[\]-]+)/g],
  ['uv', /\buv tool install\s+([A-Za-z0-9._\[\]-]+)/g],
  ['uvx', /\buvx\s+([A-Za-z0-9._-]+)/g],
  ['cargo', /\bcargo install\s+(?:--locked\s+)?([A-Za-z0-9_-]+)/g],
  ['go', /\bgo install\s+([A-Za-z0-9._/-]+@[A-Za-z0-9._-]+)/g],
  ['winget', /\bwinget install\s+(?:--id\s+|-e\s+--id\s+)?([A-Za-z0-9._-]+)/g],
  ['scoop', /\bscoop install\s+([A-Za-z0-9._/-]+)/g],
  ['docker', /\bdocker run\s+[^\n`]*?\s([a-z0-9./-]+\/[a-z0-9._-]+(?::[A-Za-z0-9._-]+)?)/g],
  ['claude_mcp', /\bclaude mcp add\s+([^\n`]+)/g],
  ['claude_plugin', /\/plugin (?:install|marketplace add)\s+([^\s`]+)/g],
  ['skills_cli', /\bnpx skills add\s+([^\s`]+)/g],
  ['shadcn', /\bnpx shadcn(?:@latest)? add\s+([^\s`]+)/g],
];
export function installCommands(readme) {
  const out = {};
  if (!readme) return out;
  for (const [k, rx] of CMD_PATTERNS) {
    for (const m of readme.matchAll(rx)) {
      const v = m[1].trim().replace(/[`'"),.;]+$/, '');
      if (!v || v.startsWith('-') || v.length > 120) continue;
      (out[k] ||= []);
      if (!out[k].includes(v) && out[k].length < 5) out[k].push(v);
    }
  }
  if (out.cask && out.brew) out.brew = out.brew.filter(x => !out.cask.includes(x) && x !== '--cask');
  return out;
}

// Registry confirmation. A package only counts if its registry entry points back at the repo.
const norm = s => String(s || '').toLowerCase().replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/^git:\/\//, '').replace(/\/$/, '');
const pointsTo = (val, full) => norm(val).includes(`github.com/${full.toLowerCase()}`);

export async function npmPackage(name, full) {
  const r = await getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (!r.json?.name) return null;
  const latest = r.json['dist-tags']?.latest;
  const v = r.json.versions?.[latest] || {};
  const repo = typeof v.repository === 'string' ? v.repository : v.repository?.url;
  // npm only accepts signed provenance whose source repo matches package.json "repository", so a link
  // backed by provenance is real; a bare "repository" field can be set by anyone.
  const linked = full ? pointsTo(repo, full) || pointsTo(v.homepage, full) : null;
  return { name: r.json.name, version: latest, bin: v.bin ? Object.keys(typeof v.bin === 'string' ? { [r.json.name]: 1 } : v.bin) : [], linked, provenance: Boolean(linked && v.dist?.attestations?.provenance), deprecated: v.deprecated || null, modified: r.json.time?.modified };
}
export async function pypiPackage(name, full) {
  const r = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!r.json?.info) return null;
  const i = r.json.info;
  const urls = Object.values(i.project_urls || {}).concat([i.home_page]);
  return { name: i.name, version: i.version, requires_python: i.requires_python || null, linked: full ? urls.some(u => pointsTo(u, full)) : null };
}
export async function cratePackage(name, full) {
  const r = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  if (!r.json?.crate) return null;
  return { name: r.json.crate.name, version: r.json.crate.max_stable_version || r.json.crate.newest_version, linked: full ? pointsTo(r.json.crate.repository, full) : null };
}
export async function brewFormula(name, full, cask = false) {
  const r = await getJson(`https://formulae.brew.sh/api/${cask ? 'cask' : 'formula'}/${encodeURIComponent(name)}.json`);
  if (!r.json) return null;
  const j = r.json;
  const urls = cask ? [j.homepage, j.url] : [j.homepage, j.urls?.stable?.url, j.urls?.head?.url];
  return { name: cask ? j.token : j.name, version: cask ? j.version : j.versions?.stable, linked: full ? urls.some(u => pointsTo(u, full)) : null, deprecated: j.deprecated || j.disabled || false };
}

function skillName(md) { return md?.match(/^---\s*\n[\s\S]*?\nname:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || null; }
// Frontmatter description, including YAML block scalars (description: >- / | followed by indented lines).
export function skillDesc(md) {
  const fm = md?.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
  if (!fm) return null;
  const m = fm.match(/^description:[ \t]*(.*)$/m);
  if (!m) return null;
  let v = m[1].trim();
  if (!v || /^[>|][+-]?$/.test(v)) {
    const rest = fm.slice(fm.indexOf(m[0]) + m[0].length).split('\n').slice(1);
    const lines = [];
    for (const l of rest) { if (/^\s+\S/.test(l) || (l.trim() === '' && lines.length)) lines.push(l.trim()); else break; }
    v = lines.join(' ').replace(/\s+/g, ' ').trim();
  }
  return v.replace(/^["']|["']$/g, '').slice(0, 300) || null;
}

export async function inspectGithub(db, full, { onLog = () => {} } = {}) {
  const facts = { source: 'github', full_name: full, inspected_at: new Date().toISOString() };
  const meta = await ghFetch(db, `/repos/${full}`);
  if (meta.status === 404) return { ...facts, reachable: false, http: 404 };
  if (meta.status !== 200) return { ...facts, reachable: null, http: meta.status };
  const m = meta.body;
  if (m.full_name && m.full_name.toLowerCase() !== full.toLowerCase()) facts.moved_to = m.full_name;
  full = m.full_name || full;
  Object.assign(facts, {
    reachable: true, description: m.description, homepage: m.homepage || null, topics: m.topics || [], language: m.language,
    license: m.license?.spdx_id || 'none', stars: m.stargazers_count, forks: m.forks_count, open_issues: m.open_issues_count,
    pushed_at: m.pushed_at, created_at: m.created_at, archived: Boolean(m.archived), default_branch: m.default_branch, size_kb: m.size,
  });
  const ref = m.default_branch;
  const tree = await ghFetch(db, `/repos/${full}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { timeoutMs: 30000 }).catch(() => null);
  const files = (tree?.body?.tree || []).filter(e => e.type === 'blob').map(e => e.path);
  facts.files_total = files.length;
  facts.tree_truncated = Boolean(tree?.body?.truncated);
  const has = p => files.includes(p);
  const INTERNAL = /^\.(claude|agents|codex|cursor|github|gemini|opencode|windsurf)\//;
  const skillFiles = files.filter(f => /(^|\/)SKILL\.md$/.test(f) && !/(^|\/)(node_modules|test|tests|fixtures|examples?)\//.test(f));
  facts.layout = {
    package_json: has('package.json'), pyproject: has('pyproject.toml'), setup_py: has('setup.py'), cargo: has('Cargo.toml'), go_mod: has('go.mod'),
    dockerfile: files.some(f => /(^|\/)Dockerfile$/.test(f)), marketplace: has('.claude-plugin/marketplace.json'), plugin: has('.claude-plugin/plugin.json'),
    mcp_server_json: has('server.json'), smithery: has('smithery.yaml'), skills: skillFiles.length, mcp_json: has('.mcp.json'),
    xcode: files.some(f => f.endsWith('.xcodeproj/project.pbxproj')), gradle: has('build.gradle') || has('build.gradle.kts') || has('settings.gradle.kts'),
    install_sh: has('install.sh'), skills_product: skillFiles.filter(f => !INTERNAL.test(f)).length,
  };
  onLog(`${full}: ${files.length} files, ${skillFiles.length} SKILL.md`);
  const readmePath = files.find(f => /^readme(\.[a-z]+)?$/i.test(f));
  const readme = readmePath ? (await getText(RAW(full, ref, readmePath))).text : null;
  facts.readme_chars = readme?.length || 0;
  facts.readme_commands = installCommands(readme);
  facts.mentions = readme ? {
    mcp: /\bmodel context protocol\b|\bmcp server\b|\bmcpServers\b/i.test(readme),
    claude: /\bclaude( code| desktop)?\b/i.test(readme),
    agent: /\b(ai )?agents?\b|\bllm\b/i.test(readme),
    cli: /\bcommand[- ]line\b|\bcli\b|\busage:\s/i.test(readme),
    api: /\b(rest|http|python|javascript|typescript)\s+api\b|\bsdk\b/i.test(readme),
    json_output: /--json\b|--format[ =]json|-o json/i.test(readme),
    headless: /\bheadless\b|\bscript(ing|able)\b|\bautomat(e|ion)\b/i.test(readme),
  } : {};

  if (skillFiles.length) {
    const sample = [...skillFiles.filter(f => !INTERNAL.test(f)), ...skillFiles.filter(f => INTERNAL.test(f))].slice(0, 40);
    facts.skills = [];
    for (const f of sample) {
      const md = (await getText(RAW(full, ref, f), { max: 4000 })).text;
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
      // Skills under .claude/ .agents/ .github/ … are the repository's own contributor tooling, not a product.
      facts.skills.push({ path: dir || '.', name: skillName(md) || (dir.split('/').pop() || full.split('/')[1]), description: skillDesc(md), has_scripts: files.some(x => x.startsWith(dir ? `${dir}/scripts/` : 'scripts/')), internal: INTERNAL.test(f) });
    }
  }
  if (facts.layout.marketplace) {
    const mk = (await getJson(RAW(full, ref, '.claude-plugin/marketplace.json'))).json;
    if (mk) facts.marketplace = { name: mk.name, plugins: (Array.isArray(mk.plugins) ? mk.plugins : Object.values(mk.plugins || {})).slice(0, 60).map(p => ({ name: p.name, description: (p.description || '').slice(0, 200), version: p.version || null })) };
  }
  if (facts.layout.plugin) {
    const pj = (await getJson(RAW(full, ref, '.claude-plugin/plugin.json'))).json;
    if (pj) facts.plugin = { name: pj.name, version: pj.version || null, description: (pj.description || '').slice(0, 200) };
  }
  if (facts.layout.mcp_server_json) {
    const sj = (await getJson(RAW(full, ref, 'server.json'))).json;
    if (sj) facts.mcp_registry = { name: sj.name, version: sj.version || sj.version_detail?.version, packages: (sj.packages || []).map(p => ({ registry: p.registry_type || p.registry_name, identifier: p.identifier || p.name, version: p.version, transport: p.transport?.type || null, env: (p.environment_variables || p.environmentVariables || []).map(e => ({ name: e.name, secret: Boolean(e.is_secret ?? e.isSecret), required: Boolean(e.is_required ?? e.isRequired) })) })), remotes: (sj.remotes || []).map(r => ({ type: r.type || r.transport_type, url: r.url })) };
  }

  // Package candidates: manifest names first, then README commands, then the repo name.
  const pk = { npm: new Set(), pypi: new Set(), crate: new Set(), brew: new Set(), cask: new Set() };
  if (facts.layout.package_json) {
    const pj = (await getJson(RAW(full, ref, 'package.json'))).json;
    if (pj) { facts.package_json = { name: pj.name, private: Boolean(pj.private), bin: pj.bin ? (typeof pj.bin === 'string' ? [pj.name] : Object.keys(pj.bin)) : [], keywords: (pj.keywords || []).slice(0, 15), workspaces: Boolean(pj.workspaces), engines: pj.engines || null }; if (pj.name && !pj.private) pk.npm.add(pj.name); }
  }
  if (facts.layout.pyproject) {
    const t = (await getText(RAW(full, ref, 'pyproject.toml'))).text || '';
    const name = tomlValue(t, 'project', 'name') || tomlValue(t, 'tool.poetry', 'name');
    facts.pyproject = { name, scripts: tomlTableKeys(t, 'project.scripts').concat(tomlTableKeys(t, 'tool.poetry.scripts')), requires_python: tomlValue(t, 'project', 'requires-python') };
    if (name) pk.pypi.add(name);
  }
  if (facts.layout.cargo) {
    const t = (await getText(RAW(full, ref, 'Cargo.toml'))).text || '';
    const name = tomlValue(t, 'package', 'name');
    facts.cargo = { name, workspace: /^\s*\[workspace\]/m.test(t), bins: [...t.matchAll(/\[\[bin\]\][^[]*?name\s*=\s*"([^"]+)"/g)].map(x => x[1]) };
    if (name) pk.crate.add(name);
  }
  const rc = facts.readme_commands;
  for (const v of [...(rc.npm || []), ...(rc.npx || [])]) pk.npm.add(v.replace(/@[^@/]+$/, '').replace(/^(@[^/]+\/[^@]+)@.*/, '$1'));
  for (const v of [...(rc.pip || []), ...(rc.pipx || []), ...(rc.uv || []), ...(rc.uvx || [])]) pk.pypi.add(v.replace(/\[.*\]$/, ''));
  for (const v of rc.cargo || []) pk.crate.add(v);
  for (const v of rc.brew || []) if (!v.includes('/')) pk.brew.add(v);
  for (const v of rc.cask || []) if (!v.includes('/')) pk.cask.add(v);
  const repoName = full.split('/')[1].toLowerCase();
  pk.brew.add(repoName); pk.cask.add(repoName);

  facts.packages = {};
  const tryAll = async (set, fn, key, limit = 4) => {
    for (const n of [...set].slice(0, limit)) {
      const r = await fn(n, full).catch(() => null);
      if (r) (facts.packages[key] ||= []).push(r);
    }
  };
  await tryAll(pk.npm, npmPackage, 'npm');
  await tryAll(pk.pypi, pypiPackage, 'pypi');
  await tryAll(pk.crate, cratePackage, 'crates');
  await tryAll(pk.brew, (n, f) => brewFormula(n, f, false), 'brew');
  await tryAll(pk.cask, (n, f) => brewFormula(n, f, true), 'cask');
  // Name-guessed matches that don't point back at the repo are someone else's package.
  for (const k of Object.keys(facts.packages)) {
    // A registry name that merely equals the repo's manifest name may be unpublished and squatted.
    facts.packages[k] = facts.packages[k].filter(p => p.linked !== false);
    if (!facts.packages[k].length) delete facts.packages[k];
  }
  const rel = await ghFetch(db, `/repos/${full}/releases/latest`).catch(() => null);
  if (rel?.status === 200) facts.latest_release = { tag: rel.body.tag_name, published_at: rel.body.published_at, assets: (rel.body.assets || []).map(a => a.name).slice(0, 30) };
  return facts;
}

export async function inspectWeb(url) {
  const r = await getText(url, { timeoutMs: 20000, max: 300000 });
  const facts = { source: 'web', url, inspected_at: new Date().toISOString(), http: r.status, reachable: r.status >= 200 && r.status < 400, final_url: r.url || url };
  if (r.text) {
    facts.title = r.text.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim().replace(/\s+/g, ' ') || null;
    facts.description = r.text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})/i)?.[1] || r.text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,400})/i)?.[1] || null;
    facts.readme_commands = installCommands(r.text.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    facts.github_links = [...new Set([...r.text.matchAll(/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})/g)].map(x => x[1].replace(/\.git$/, '')).filter(x => !/^(sponsors|features|topics|orgs|login|about|pricing)\//.test(x)))].slice(0, 8);
  } else if (!facts.reachable) {
    const w = await webCheck(url).catch(() => null);
    if (w) { facts.http = w.status ?? facts.http; facts.reachable = Boolean(w.ok); }
  }
  return facts;
}
