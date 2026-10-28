// Deterministic URL / repo identity normalization. Original strings are always kept separately.

const GH_RESERVED = new Set(['topics', 'trending', 'marketplace', 'orgs', 'features', 'collections', 'search', 'sponsors', 'settings', 'explore']);

export function normalizeUrl(raw) {
  const u = new URL(String(raw).trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Unsupported protocol: ${u.protocol}`);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$/.test(k)) u.searchParams.delete(k);
  let p = u.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (u.hostname === 'github.com') p = p.toLowerCase();
  u.pathname = p || '/';
  let s = u.toString();
  if (u.pathname === '/' && !u.search) s = s.replace(/\/$/, '');
  return s;
}

export function githubRepo(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'github.com') return null;
  const [owner, repo] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repo || GH_RESERVED.has(owner.toLowerCase())) return null;
  return { owner, repo: repo.replace(/\.git$/, ''), fullName: `${owner}/${repo.replace(/\.git$/, '')}`.toLowerCase() };
}

export function githubTopic(raw) {
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/^\/topics\/([^/]+)/);
    return u.hostname.endsWith('github.com') && m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

export function slugId(raw) {
  const gh = githubRepo(raw);
  if (gh) return `gh:${gh.fullName}`;
  const n = normalizeUrl(raw).replace(/^https:\/\//, '');
  return `web:${n.replace(/[^a-z0-9./_-]+/gi, '-').toLowerCase()}`;
}

export function extractUrls(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) out.push({ url: m[0].replace(/[.,;]+$/, ''), line: i + 1 });
  });
  return out;
}
