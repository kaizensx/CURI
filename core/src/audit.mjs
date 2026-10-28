// Registry audit: overlaps, skill-pack precedence, risks, unavailable/unknown evidence.

// Precedence (V2-09): only one orchestration framework drives a workflow at a time.
export const PRECEDENCE = [
  { rank: 1, rule: 'Oficial Anthropic (anthropics/*) e skills já ativas no ambiente do utilizador', match: r => /^gh:anthropics\//.test(r.id) },
  { rank: 2, rule: 'Oficial do fornecedor da plataforma (Expo, Vercel, GSAP, Android, Google, Cloudflare)', match: r => /^gh:(expo|vercel-labs|greensock|android|google|cloudflare)\//.test(r.id) },
  { rank: 3, rule: 'Skills focadas e composable com um objetivo único', match: r => r.type === 'Skill' },
  { rank: 4, rule: 'Packs/harnesses grandes (Superpowers, ECC, Everything Claude Code, wshobson/agents...) apenas sob demanda, nunca vários em simultâneo', match: () => true },
];

export function precedenceRank(r) { return PRECEDENCE.find(p => p.match(r)).rank; }

export function resourceAudit(db) {
  const agentRes = db.prepare(`SELECT r.id, r.name, r.type, r.status, r.risk_notes, group_concat(rc.capability_id) caps FROM resources r JOIN resource_capabilities rc ON rc.resource_id=r.id
    WHERE r.type IN ('Skill','Plugin') GROUP BY r.id`).all().map(r => ({ ...r, caps: r.caps.split(','), rank: precedenceRank(r) }));
  const overlapByCap = {};
  for (const r of agentRes) for (const c of r.caps) if (c !== 'agent-skills') (overlapByCap[c] ||= []).push(r);
  const overlaps = Object.entries(overlapByCap).filter(([, v]) => v.length > 1).map(([cap, v]) => ({
    capability: cap,
    resources: v.sort((a, b) => a.rank - b.rank).map(r => ({ id: r.id, name: r.name, rank: r.rank })),
    preferred: v[0].id,
    policy: 'Usar o de menor rank; restantes ficam ON_DEMAND/CATALOGUED.',
  }));
  const orchestration = agentRes.filter(r => r.caps.includes('agent-orchestration')).map(r => ({ id: r.id, name: r.name, rank: r.rank }));
  return {
    precedence_policy: PRECEDENCE.map(({ rank, rule }) => ({ rank, rule })),
    skill_overlaps: overlaps,
    orchestration_frameworks: { count: orchestration.length, items: orchestration, rule: 'No máximo um framework de orquestração ativo por sessão/projeto.' },
    multi_source_resources: db.prepare('SELECT resource_id id, COUNT(*) n FROM resource_urls GROUP BY resource_id HAVING COUNT(DISTINCT url_normalized) > 1').all(),
    risks: db.prepare("SELECT id, name, risk_notes FROM resources WHERE risk_notes IS NOT NULL AND risk_notes <> ''").all(),
    unavailable_or_deprecated: db.prepare("SELECT id, name, status FROM resources WHERE status IN ('UNAVAILABLE','DEPRECATED')").all(),
    unknown_license: db.prepare("SELECT COUNT(*) n FROM resources WHERE license='unknown' AND type IN ('Library','Framework','Tool','Skill','Plugin','MCP')").get().n,
    never_verified: db.prepare('SELECT COUNT(*) n FROM resources WHERE last_verified IS NULL').get().n,
    pending_review: db.prepare("SELECT id, name, created_at FROM resources WHERE status='PENDING_REVIEW'").all(),
  };
}
