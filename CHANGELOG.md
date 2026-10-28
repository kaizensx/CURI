# Alterações

## 3.2.0 — 2026-10-28

A versão em que o CURI deixou de ser um catálogo e passou a fazer o trabalho.

- Navegação nova: Início, Biblioteca, Descobrir, Capacidades, Este dispositivo e Ligações. Atividade e Definições passam a ter separadores. Os endereços antigos continuam a funcionar.
- Visual novo, com a Geist incluída na app, estados de presença claros e o mapa do ambiente no Início.
- Todas as sementes do catálogo inicial foram inspecionadas: ficheiros, manifestos, README e confirmação nos registos npm, PyPI, crates.io e Homebrew. Os dados vêm com a app e cada recurso pode ser atualizado à mão.
- Cada recurso tem o seu tipo real e ações reais:
  - instalar, atualizar e remover pelo gestor de pacotes;
  - plugins do Claude Code;
  - servidores MCP;
  - adicionar bibliotecas a um projeto com o gestor desse projeto;
  - catálogos de componentes através do MCP do shadcn.
- Personalização: favoritos, coleções, notas, tipo e comando próprios, ocultar recursos.
- Deteção em Claude Code, Claude Desktop, conta claude.ai, Codex, Cursor, Gemini CLI, Windsurf e VS Code.
- Base para Windows e Linux (gestores de pacotes, aplicações, cofre de credenciais). Está implementada mas ainda não foi testada nesses sistemas.
- Capacidades em linguagem simples, com o passo que falta para cada uma.
- Comparação por diferenças concretas, sem pontuação total.
- Descobrir por utilidade para agentes:
  - filtros por interface, domínio e utilidade;
  - pesquisas guardadas que podem correr sozinhas;
  - revisão das estrelas do GitHub;
  - reutilização da sessão do GitHub CLI.
- Manutenção automática dentro do modo de autonomia escolhido.
- Corrigido: a barra lateral ficava por baixo dos botões da janela no macOS.

## 3.1.0 — 2026-10-28

- Ligação ao Claude Code sem terminal, com cancelamento e estados claros.
- Ligações a GitHub, Anthropic, OpenAI e Google, com as chaves no Porta-chaves.
- Modos de autonomia, com uma tabela do que cada um faz sem perguntar.
- Fila de operações que sobrevive a reinícios e nunca duplica trabalho.
- Janela de progresso para todas as operações.
- Serviço de fundo opcional.
- Identidade visual.

## 3.0.0 — 2026-10-28

Primeira versão: registo local, pesquisa por intenção, radar do GitHub, integração com o Claude Code e app para macOS.
