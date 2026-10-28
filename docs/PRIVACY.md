# Privacidade

O CURI guarda tudo localmente em `~/Library/Application Support/CURI/`. Não há conta CURI, servidor CURI, telemetria nem relatórios de falhas automáticos.

## O que sai do seu Mac, e quando

| Destino | Quando | Conteúdo | Pode desligar |
|---|---|---|---|
| `api.github.com`, `github.com`, `codeload.github.com` | Verificar fontes, radar, instalar skills | Termos de pesquisa, nomes de repositórios; token se o ligou | Não usar o radar; sem token = anónimo |
| `api.anthropic.com` | Verificar a disponibilidade de rede; testar a chave API se a guardou | Um pedido HEAD; `GET /v1/models` com a chave | Sim |
| Claude (via Claude Code) | Só quando pede "Verificar com um pedido real" | Um prompt fixo de teste; consome uso da sua conta | Sim (nunca automático) |
| `api.openai.com`, `generativelanguage.googleapis.com` | Testar a chave que guardou | Pedido de listagem de modelos | Sim |
| `nodejs.org`, `registry.npmjs.org` | Instalar dependências em falta, ativar MCP via npx | Pedidos de download | Sim (com Node e Claude já instalados) |
| `registry.npmjs.org`, `pypi.org`, `crates.io`, `formulae.brew.sh`, `raw.githubusercontent.com` | Atualizar os dados de um recurso | Nomes de pacotes e de repositórios | Sim (os dados das sementes vêm com a app) |
| Gestores de pacotes (Homebrew, npm, uv, WinGet…) | Quando instala, atualiza ou remove algo | O que o gestor normalmente pede ao seu repositório | Sim |
| `api.github.com/user/starred` | Quando pede para ler as suas estrelas, ou se ativar essa tarefa automática | O seu token GitHub | Sim |
| Servidores MCP que ativar | Quando o Claude os usa | O que esse servidor envia, segundo a política dele | Desativar o servidor |

## O que é lido no seu dispositivo (nunca enviado)
Para reconhecer o que já tem, a deteção lê, só em leitura: nomes de aplicações e executáveis, listas dos gestores de pacotes, e a configuração de servidores MCP, skills e plugins de cada agente (`~/.claude.json`, `~/.claude/skills`, `.mcp.json` dos projetos conhecidos, `claude plugin list`, `claude_desktop_config.json`, `~/.codex/config.toml` e `~/.codex/skills`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`, Windsurf e VS Code). Das skills da conta claude.ai lê apenas o manifesto que o Claude Desktop sincroniza (nome, descrição, ativo). Ficheiros de autenticação (`auth.json`, cookies, tokens) nunca são abertos. A sessão do GitHub CLI só é reutilizada quando carrega em "Reutilizar esta sessão", através do comando oficial `gh auth token`.

## O que nunca é enviado
Conteúdo dos seus projetos, ficheiros, histórico de conversas do Claude, credenciais para serviços que não as pediram.

## Retenção e remoção
- Registo de auditoria e operações: locais; exportáveis em Definições.
- Remover uma ligação apaga a credencial do Porta-chaves (a chave continua válida no fornecedor até a revogar lá).
- Apagar `~/Library/Application Support/CURI/` remove todos os dados do CURI; a integração Claude reverte-se em Claude Bridge → Transações.

O consentimento para instalações automáticas (Automação) é separado do consentimento para gastos (pedidos a modelos), que é sempre pedido.
