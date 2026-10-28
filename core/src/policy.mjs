// Autonomy modes as an explicit operation-permission matrix, standing consent with revocation, and the
// pre-execution decision rules. A mode never overrides a failed technical check or native OS authorization.
import { now, getPref, setPref } from './db.mjs';
import { audit } from './audit-log.mjs';

export const POLICY_VERSION = 'curi-autonomy-1';
export const MODES = ['standard', 'automatic', 'maximum'];
export const MODE_LABEL = { standard: 'Standard', automatic: 'Automatic', maximum: 'Maximum autonomy' };

// category -> decision per mode: 'auto' (no app prompt), 'ask' (explicit approval per operation).
// Native administrator dialogs are always additionally required for 'privileged' work.
export const MATRIX = {
  observe:          { label: 'Verify sources, refresh metadata, test connections and health', standard: 'auto', automatic: 'auto', maximum: 'auto' },
  curi_integration: { label: 'Install, repair or update CURI\'s own skill and MCP', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  runtime:          { label: 'Install or update CURI\'s runtime (Node.js inside CURI\'s folder)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  cleanup:          { label: 'Clean up CURI\'s temporary files', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  skill_trusted:    { label: 'Install skills from trusted publishers (pinned commit, clean scan)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  mcp_trusted:      { label: 'Register MCP servers from trusted publishers', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  package_trusted:  { label: 'Install tools and apps from trusted publishers through the package manager (Homebrew, npm, uv, WinGet…)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  package_verified: { label: 'Install catalogue packages whose source is confirmed in the official registry (npm, PyPI, Homebrew)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  plugin_trusted:   { label: 'Install Claude Code plugins from trusted publishers', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  project_change:   { label: 'Add libraries and components to one of your projects (changes package.json/pyproject)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  maintenance:      { label: 'Update, re-enable and repair what\'s already installed', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  background:       { label: 'Install CURI\'s background service (user LaunchAgent)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  untrusted:        { label: 'Install from unknown publishers', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  destructive:      { label: 'Remove, uninstall or roll back', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  privileged:       { label: 'Administrator actions (with the system\'s own dialog)', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  costly:           { label: 'Actions that spend paid usage (model requests)', standard: 'ask', automatic: 'ask', maximum: 'ask' },
};

export const DEFAULT_TRUSTED = ['anthropics', 'modelcontextprotocol', 'microsoft', 'chromedevtools', 'upstash', 'vercel-labs', 'expo', 'greensock', 'google', 'android', 'cloudflare'];

export function currentConsent(db) {
  const r = db.prepare('SELECT * FROM consent WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1').get();
  return r ? { ...r, scopes: JSON.parse(r.scopes) } : { mode: 'standard', scopes: {}, policy_version: POLICY_VERSION, granted_at: null, implicit: true };
}

export function trustedPublishers(db) { return getPref(db, 'trusted_publishers', DEFAULT_TRUSTED).map(x => x.toLowerCase()); }
export function setTrustedPublishers(db, list, actor = 'user') {
  const clean = [...new Set(list.map(x => String(x).trim().toLowerCase()).filter(x => /^[a-z0-9][a-z0-9-]{0,38}$/.test(x)))];
  setPref(db, 'trusted_publishers', clean);
  audit(db, actor, 'policy.trusted_publishers', null, { count: clean.length });
  return clean;
}

export function grantMode(db, mode, { actor = 'user' } = {}) {
  if (!MODES.includes(mode)) throw new Error('Invalid mode.');
  const ts = now();
  db.prepare('UPDATE consent SET revoked_at=? WHERE revoked_at IS NULL').run(ts);
  const scopes = Object.fromEntries(Object.entries(MATRIX).map(([k, v]) => [k, v[mode]]));
  db.prepare('INSERT INTO consent(mode,scopes,policy_version,granted_at,actor) VALUES (?,?,?,?,?)').run(mode, JSON.stringify(scopes), POLICY_VERSION, ts, actor);
  audit(db, actor, 'consent.grant', mode, { policy_version: POLICY_VERSION, auto: Object.keys(scopes).filter(k => scopes[k] === 'auto') });
  return currentConsent(db);
}

// Revocation drops to Standard immediately; callers re-evaluate queued work.
export function revoke(db, { actor = 'user' } = {}) {
  const ts = now();
  db.prepare('UPDATE consent SET revoked_at=? WHERE revoked_at IS NULL').run(ts);
  audit(db, actor, 'consent.revoke', null, null);
  return currentConsent(db);
}

// Pre-execution decision: covered by consent? source trusted? checks passed? scope unchanged?
export function evaluate(db, op) {
  const consent = currentConsent(db);
  const reasons = [];
  let category = op.category;
  const trustScoped = ['skill_trusted', 'mcp_trusted', 'package_trusted', 'plugin_trusted'];
  if (trustScoped.includes(category) && (!op.publisher || !trustedPublishers(db).includes(op.publisher.toLowerCase()))) {
    // A catalogued package whose registry entry points back at its repository keeps a verified provenance.
    category = category === 'package_trusted' && op.verifiedSource ? 'package_verified' : 'untrusted';
    reasons.push(op.publisher ? `Publisher "${op.publisher}" isn't on the trusted list.` : 'Unknown publisher.');
  }
  const rule = MATRIX[category];
  if (!rule) return { decision: 'block', category, reasons: [`Unknown category: ${category}`] };
  for (const c of op.checks || []) {
    if (c.ok === false) return { decision: 'block', category, reasons: [...reasons, `A required check failed: ${c.name} (${c.detail})`] };
  }
  if (op.requiresConnection && !op.connectionOk) return { decision: 'block', category, reasons: [...reasons, `Needs a connection to ${op.requiresConnection}.`] };
  if (op.scopeChanged) { reasons.push('The requested permissions changed since the last approval.'); return { decision: 'ask', category, mode: consent.mode, reasons }; }
  const decision = rule[consent.mode] || 'ask';
  reasons.push(decision === 'auto' ? `Covered by ${MODE_LABEL[consent.mode]} mode (${rule.label}).` : `${MODE_LABEL[consent.mode]} mode needs approval for: ${rule.label}.`);
  if (category === 'privileged') reasons.push('The system will ask for the administrator password.');
  return { decision, category, mode: consent.mode, reasons };
}
