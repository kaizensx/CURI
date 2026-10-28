# Contratos entre componentes

## Responsabilidades

| Componente | Faz | Não faz |
|---|---|---|
| **Shell (Rust, `desktop/`)** | Verifica/instala dependências na pasta do CURI, com progresso; lança o Core; menu nativo; estado da janela. | Não toca no perfil Claude; não guarda dados; a UI não lhe acede por IPC (só arrastar a janela). |
| **Core (Node, `core/`)** | Única fonte de verdade: base de dados, política, fila de operações, instaladores, Porta-chaves, API local, CLI, MCP. | Não executa nada fora dos *handlers* registados; não expõe segredos. |
| **Interface (`app/`)** | Mostra o estado real e envia ações de uma lista fechada (`core/src/api.mjs → ACTIONS`). | Não guarda estado de verdade (só preferências visuais em `localStorage`). |
| **Serviço de fundo** | `curi daemon --once` periódico: recupera trabalho interrompido, corre operações aprovadas/cobertas, agenda verificações. | Não aprova nada; respeita a política e "pausar com bateria". |
| **Claude Code** | Arranca o MCP do CURI e os servidores MCP ativados (através do launcher). | — |

## Pedidos e erros
- Interface → Core: `POST /api/<ação>` com JSON; resposta `{ ok, data }` ou `{ ok: false, error }` (HTTP 4xx). Token *bearer*, `Host` e `Origin` verificados.
- Operações: `opPreview` (decisão sem efeitos) → `opEnqueue` (`approved: true` quando o utilizador confirmou) → estados `awaiting_approval | queued | running | verified | completed | failed | cancelled | blocked | rejected`. Progresso por `stage` + `progress` (0–1 só quando mensurável).

## Propriedade de ficheiros

| Caminho | Dono | O CURI pode |
|---|---|---|
| `~/Library/Application Support/CURI/` | CURI | Tudo (dados, backups, runtime, logs) |
| `~/.claude/skills/<nome>/` com `.curi-managed.json` | CURI | Instalar, atualizar, mover para backups |
| `~/.claude/skills/<nome>/` sem marcador | Utilizador | Ler e analisar; **nunca** escrever |
| `~/.claude.json` → `mcpServers.<nome>` criados pelo CURI | CURI (via `claude mcp add/remove`) | Adicionar/remover só essas entradas, verificando que as restantes não mudaram |
| `~/.claude.json` restante, `~/.claude/settings.json`, `CLAUDE.md` | Utilizador / Claude Code | Ler; backup antes de alterações; **nunca** reescrever |
| `~/Library/LaunchAgents/app.curi.agent.plist` | CURI | Criar/remover com aprovação |
| `/usr/local/bin/curi` | CURI (ação de administrador) | Criar ligação com o diálogo nativo |
| Porta-chaves, serviço `app.curi.credentials` | CURI | Guardar/ler/apagar só as suas entradas |

## Nível de suporte das integrações

| Integração | Nível | Verificação |
|---|---|---|
| Claude Code CLI 2.1.309–2.1.312 | Suportado e testado | `claude auth status`, `claude mcp list`, pedido real opcional |
| Skills de `anthropics/skills` | Suportado e testado | Commit fixado, checksums, frontmatter |
| MCP Context7 (stdio via npx) | Suportado e testado com o Claude real | `claude mcp list` ✔ Connected |
| MCP Playwright, Chrome DevTools | Pré-configurado, mesmo mecanismo; não testado individualmente | `claude mcp list` |
| MCP Firecrawl | Pré-configurado; requer chave paga; editor fora da lista de confiança | Bloqueado até existir a chave |
| MCP HTTP/SSE personalizados | Registo suportado; OAuth feito pelo Claude Code (`/mcp`) | Estado reportado pelo Claude |
| GitHub, Anthropic, OpenAI, Google (chaves) | Suportado; caminho de chave inválida testado contra o GitHub real | Pedido de leitura ao fornecedor |
| Windows / Linux | **Não suportado** | — |

## Persistência e recuperação
Esquema SQLite versionado (v3) com cópia antes de cada migração; um cliente mais antigo recusa abrir uma base mais nova. A fila de operações retoma trabalho `running` como `queued` após reinício; os *handlers* são idempotentes (ex.: skill com o mesmo commit e checksums → nada a fazer).
