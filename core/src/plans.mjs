// Install *plans* for registry resources. Plans are descriptive only: nothing here executes code.
import { getResource } from './registry.mjs';

export function installPlan(db, id) {
  const r = getResource(db, id);
  if (!r) throw new Error(`Unknown resource: ${id}`);
  const steps = [];
  const risks = new Set(['READ_ONLY']);
  steps.push({ step: 'verify-source', detail: 'Confirm the canonical URL, licence, latest commit/release and maintainer (curi verify <id>).', risk: 'NETWORK_DISCOVERY' });
  risks.add('NETWORK_DISCOVERY');
  switch (r.type) {
    case 'Skill':
    case 'Plugin':
      steps.push({ step: 'static-scan', detail: 'Fetch SKILL.md / hooks / scripts as data and run the static scanner (curi scan). Hooks and scripts need human review.', risk: 'READ_ONLY' });
      steps.push({ step: 'conflict-check', detail: 'Compare names and triggers with existing skills and active plugins; avoid installing the same skill both as a plugin and as a manual copy.', risk: 'READ_ONLY' });
      steps.push({ step: 'install', detail: r.type === 'Plugin' ? 'Install through Claude Code\'s official plugin mechanism (/plugin), pinning version/commit.' : 'Prefer the official plugin/marketplace install; otherwise a copy pinned to a commit in ~/.claude/skills/<name>, with a backup.', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('LOCAL_FILE_WRITE'); risks.add('THIRD_PARTY_EXECUTION');
      break;
    case 'MCP':
      steps.push({ step: 'review-permissions', detail: 'Review exposed tools, network/file access, required credentials and transport (stdio vs HTTP).', risk: 'READ_ONLY' });
      steps.push({ step: 'register', detail: 'Register with `claude mcp add` at the narrowest scope needed (project/local before user), with a backup of ~/.claude.json.', risk: 'LOCAL_FILE_WRITE' });
      steps.push({ step: 'health', detail: 'Prove it works with `claude mcp list` (configured isn\'t the same as working).', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('LOCAL_FILE_WRITE'); risks.add('THIRD_PARTY_EXECUTION');
      if (r.paid_auth) risks.add('CREDENTIAL_ACCESS');
      break;
    case 'Library':
    case 'Framework':
    case 'Template':
      steps.push({ step: 'project-scope', detail: 'A project dependency, not a global one. Add it only to the project that uses it, with the project\'s package manager and lockfile.', risk: 'LOCAL_FILE_WRITE' });
      risks.add('LOCAL_FILE_WRITE');
      break;
    case 'Tool':
      steps.push({ step: 'package-manager', detail: 'Prefer the official package manager (brew/pipx/npm -g) with a pinned version; never `curl | sh` without review.', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('THIRD_PARTY_EXECUTION');
      break;
    default:
      steps.push({ step: 'consult', detail: 'Reference material (docs/directory/inspiration): nothing to install. Consult on demand.', risk: 'READ_ONLY' });
  }
  if (r.paid_auth) { steps.push({ step: 'cost', detail: `Needs an account/payment: ${r.paid_auth}. Confirm the cost before enabling.`, risk: 'COST_BEARING' }); risks.add('COST_BEARING'); }
  if (r.risk_notes) steps.push({ step: 'risk', detail: r.risk_notes, risk: 'EXTERNAL_SCAN' });
  return {
    resource: { id: r.id, name: r.name, type: r.type, status: r.status, canonical_url: r.canonical_url, license: r.license, last_verified: r.last_verified },
    executes: false,
    requires_user_approval: [...risks].some(x => x !== 'READ_ONLY' && x !== 'NETWORK_DISCOVERY'),
    risk_classes: [...risks],
    steps,
    note: 'Descriptive plan. CURI doesn\'t run third-party installs from MCP/CLI without the user\'s explicit approval in the app.',
  };
}
