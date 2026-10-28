# Contribuir

Obrigado por querer melhorar o CURI. Algumas regras mantêm o projeto honesto e seguro.

## Antes de abrir um PR
- `cd core && npm test` tem de passar. Os testes e2e só correm se tiver o Claude Code instalado; usam sempre perfis Claude temporários.
- Abra a app (`node core/bin/curi.mjs app`) e veja os ecrãs que mudou, em escuro e claro, e a 960 px de largura.
- Nada de dados inventados na interface: métricas, estados e progresso vêm do motor. Sem dados, um estado vazio explícito.
- Texto de interface em português de Portugal, curto e acionável. Erros dizem o que aconteceu e o que fazer.

## Áreas sensíveis (descreva o risco no PR)
- `core/src/policy.mjs` — a matriz de autonomia. Alargar uma categoria a "automático" precisa de justificação.
- `core/src/installers.mjs` — tudo o que escreve fora da pasta de dados do CURI.
- `core/src/vault.mjs`, `core/src/connections.mjs` — credenciais. Segredos nunca em argv, logs, exportações nem respostas da API.
- `core/src/mcp.mjs`, `core/src/server.mjs` — superfícies expostas ao Claude e à interface.

## Integrações novas
Uma integração entra no catálogo de um clique (`core/data/presets.json`) só com: editor identificado, versão fixada, licença verificada, e um teste que prove que fica operacional (não só "instalada").

## Marca
Os ativos são gerados por `node brand/build.mjs` a partir de uma única geometria. Não edite os PNG à mão.
