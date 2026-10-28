// Evidence-aware candidate scoring. Components without evidence are null (not guessed) and the
// result carries a confidence = share of weight that had evidence.
import { detectCapabilities } from './taxonomy.mjs';

export const WEIGHTS = { relevance: 0.25, differentiation: 0.20, compatibility: 0.15, security: 0.15, maintenance: 0.10, integration: 0.10, licensing: 0.05 };
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|Unlicense|0BSD|CC0-1\.0|Zlib)$/i;
const COPYLEFT = /^(GPL|AGPL|LGPL|EUPL|OSL)/i;

export function scoreCandidate({ queryText = '', description = '', topics = [], name = '', license = null, pushedAt = null, archived = false, securityFindings = null }, { registryCapCounts = new Map(), refDate = new Date() } = {}) {
  const c = {}, why = {};
  const qCaps = new Set(detectCapabilities(queryText).map(x => x.id));
  const candCaps = detectCapabilities([name.replace(/[-_]/g, ' '), description, topics.join(' ')].join(' ')).map(x => x.id);
  if (description || topics.length) {
    const overlap = candCaps.filter(x => qCaps.has(x)).length;
    c.relevance = qCaps.size ? Math.min(1, overlap / qCaps.size + (overlap ? 0.2 : 0)) : (candCaps.length ? 0.4 : 0.1);
    why.relevance = `${overlap} capabilit${overlap === 1 ? 'y' : 'ies'} in common with the intent`;
    if (candCaps.length) {
      const rare = candCaps.filter(x => (registryCapCounts.get(x) || 0) < 3).length;
      c.differentiation = Math.min(1, 0.3 + rare / candCaps.length * 0.7);
      why.differentiation = `${rare}/${candCaps.length} capabilities poorly covered in the registry`;
    }
  }
  const t = new Set(topics.map(String));
  if (['mcp', 'mcp-server', 'claude-code', 'agent-skills', 'claude-skills', 'model-context-protocol'].some(x => t.has(x))) { c.compatibility = 0.8; why.compatibility = 'topics declare agent/MCP integration (not tested)'; }
  if (securityFindings) { c.security = securityFindings.high ? 0 : securityFindings.medium ? 0.5 : 0.9; why.security = `static analysis: ${JSON.stringify(securityFindings)}`; }
  if (pushedAt) {
    const days = (refDate - new Date(pushedAt)) / 86400000;
    c.maintenance = archived ? 0 : days < 30 ? 1 : days < 180 ? 0.7 : days < 365 ? 0.4 : 0.15;
    why.maintenance = archived ? 'arquivado' : `last push ${Math.round(days)} days ago`;
  }
  if (license !== null) {
    c.licensing = license === 'none' ? 0.1 : PERMISSIVE.test(license) ? 1 : COPYLEFT.test(license) ? 0.6 : 0.4;
    why.licensing = `licence ${license}`;
  }
  const gates = [];
  if (archived) gates.push('archived repository');
  if (securityFindings?.high) gates.push('critical security findings');
  let wsum = 0, acc = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) if (c[k] != null) { wsum += w; acc += w * c[k]; }
  return {
    components: Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, c[k] ?? null])),
    rationale: why,
    total: wsum ? Math.round(acc / wsum * 1000) / 1000 : null,
    confidence: Math.round(wsum * 100) / 100,
    hard_gates: gates,
    note: wsum < 0.5 ? 'Not enough evidence for a recommendation: candidate only.' : null,
  };
}
