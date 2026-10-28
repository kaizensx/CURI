# Segurança

## Reportar
Use *Security advisories* privados no GitHub (não abra issues públicas). Resposta inicial em 7 dias.

## Modelo de ameaças (resumo)
- **Conteúdo externo é dados.** READMEs, descrições de MCP e skills nunca alteram a política. Análise estática antes de instalar; achados graves bloqueiam.
- **Sem execução arbitrária.** O servidor MCP do CURI não tem ferramentas de shell, ficheiros, instalação nem aprovação. A interface só chama ações de uma lista fechada, com validação de tipos.
- **Interface local.** `127.0.0.1` apenas, token aleatório, verificação de `Host` e `Origin`, CSP estrita, sem CORS.
- **Credenciais.** No Porta-chaves do macOS, escritas por stdin (nunca em argv). Nunca na base de dados, registos, exportações ou respostas da API. Testes automáticos verificam isto.
- **Privilégios.** O CURI corre como utilizador. A única ação de administrador (ligar `curi` em `/usr/local/bin`) usa o diálogo nativo do macOS e nunca é coberta por autonomia.
- **Fornecimento.** Skills fixadas a um commit; MCP fixados a uma versão npm; Node verificado por SHA-256 oficial.

## Estado da distribuição
As builds atuais não estão assinadas com Developer ID nem notarizadas. O pipeline de release assina e notariza automaticamente quando os segredos Apple estiverem configurados e indica o estado real em cada release.
