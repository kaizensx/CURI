// Install *plans* for registry resources. Plans are descriptive only: nothing here executes code.
import { getResource } from './registry.mjs';

export function installPlan(db, id) {
  const r = getResource(db, id);
  if (!r) throw new Error(`Recurso inexistente: ${id}`);
  const steps = [];
  const risks = new Set(['READ_ONLY']);
  steps.push({ step: 'verify-source', detail: 'Confirmar URL canónico, licença, último commit/release e mantenedor (curi verify <id>).', risk: 'NETWORK_DISCOVERY' });
  risks.add('NETWORK_DISCOVERY');
  switch (r.type) {
    case 'Skill':
    case 'Plugin':
      steps.push({ step: 'static-scan', detail: 'Obter SKILL.md / hooks / scripts como dados e correr o scanner estático (curi scan). Hooks e scripts exigem revisão humana.', risk: 'READ_ONLY' });
      steps.push({ step: 'conflict-check', detail: 'Comparar nomes e triggers com skills existentes (curi skills) e com plugins já ativos; evitar duplicar a mesma skill via plugin e via cópia manual.', risk: 'READ_ONLY' });
      steps.push({ step: 'install', detail: r.type === 'Plugin' ? 'Instalar pelo mecanismo oficial de plugins do Claude Code (/plugin), fixando versão/commit.' : 'Preferir instalação via plugin/marketplace oficial; caso contrário cópia fixada a um commit para ~/.claude/skills/<nome> com backup.', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('LOCAL_FILE_WRITE'); risks.add('THIRD_PARTY_EXECUTION');
      break;
    case 'MCP':
      steps.push({ step: 'review-permissions', detail: 'Rever ferramentas expostas, acesso a rede/ficheiros, credenciais exigidas e transporte (stdio vs HTTP).', risk: 'READ_ONLY' });
      steps.push({ step: 'register', detail: 'Registar com `claude mcp add` no âmbito mínimo necessário (projeto/local antes de user), com backup de ~/.claude.json.', risk: 'LOCAL_FILE_WRITE' });
      steps.push({ step: 'health', detail: 'Provar disponibilidade com `claude mcp list` (configurado ≠ funcional).', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('LOCAL_FILE_WRITE'); risks.add('THIRD_PARTY_EXECUTION');
      if (r.paid_auth) risks.add('CREDENTIAL_ACCESS');
      break;
    case 'Library':
    case 'Framework':
    case 'Template':
      steps.push({ step: 'project-scope', detail: 'Dependência de projeto, não global. Adicionar só no projeto que a usa, com o gestor de pacotes do projeto e lockfile.', risk: 'LOCAL_FILE_WRITE' });
      risks.add('LOCAL_FILE_WRITE');
      break;
    case 'Tool':
      steps.push({ step: 'package-manager', detail: 'Preferir gestor de pacotes oficial (brew/pipx/npm -g) com versão fixada; nunca `curl | sh` sem revisão.', risk: 'THIRD_PARTY_EXECUTION' });
      risks.add('THIRD_PARTY_EXECUTION');
      break;
    default:
      steps.push({ step: 'consult', detail: 'Recurso de consulta (documentação/diretório/inspiração): não há instalação. Consultar sob demanda.', risk: 'READ_ONLY' });
  }
  if (r.paid_auth) { steps.push({ step: 'cost', detail: `Requer conta/pagamento: ${r.paid_auth}. Confirmar custos antes de ativar.`, risk: 'COST_BEARING' }); risks.add('COST_BEARING'); }
  if (r.risk_notes) steps.push({ step: 'risk', detail: r.risk_notes, risk: 'EXTERNAL_SCAN' });
  return {
    resource: { id: r.id, name: r.name, type: r.type, status: r.status, canonical_url: r.canonical_url, license: r.license, last_verified: r.last_verified },
    executes: false,
    requires_user_approval: [...risks].some(x => x !== 'READ_ONLY' && x !== 'NETWORK_DISCOVERY'),
    risk_classes: [...risks],
    steps,
    note: 'Plano descritivo. O CURI não executa instalações de terceiros a partir de MCP/CLI sem aprovação explícita do utilizador na app.',
  };
}
