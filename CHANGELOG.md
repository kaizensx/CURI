# Changelog

## 3.3.0 — 2026-10-28

- Everything is in English now: the app, the native menu, the engine's messages, the code and the docs.
- Discover only shows what CURI can actually install. Each discovery is inspected (manifests, README, registry checks) and gets a one-click **Install**, which also installs a missing prerequisite first when that's all that stands in the way.
- The Library only lists resources CURI can act on: install, connect, add to a project, or manage what's already there.
- Libraries and frameworks can be added straight to one of your projects with its own package manager (npm, pnpm, yarn, bun or uv), and the result is checked in the manifest.
- Your own layer on top of the catalogue: favourites, collections, notes, your own kind and project command, hiding things.
- Redesigned Library (list or grid, sorting, more filters, bulk actions), Discover (install-first cards, saved searches that can run on their own), Capabilities (areas with progress rings and dense rows) and This device.
- An ambient field on Home, adapted from a HorizonX shader.
- Fixed: the sidebar sat under the macOS window buttons and never showed the native material.

## 3.2.0 — 2026-10-28

- New navigation: Home, Library, Discover, Capabilities, This device, Connections, Activity and Settings.
- Every starter seed was inspected; each resource has its real kind and real install options per operating system.
- Detection across Claude Code, Claude Desktop, your claude.ai account, Codex, Cursor, Gemini CLI, Windsurf and VS Code.
- Real actions: package managers, Claude Code plugins, MCP servers.
- Capabilities in plain language, decision-oriented comparisons, agent-relevance ranking for discoveries, GitHub stars.
- Automatic maintenance within the autonomy mode you choose.
- Groundwork for Windows and Linux (implemented, not yet tested on those systems).

## 3.1.0 — 2026-10-28

- Claude Code sign-in without a terminal.
- Connections to GitHub, Anthropic, OpenAI and Google, with keys in the system vault.
- Autonomy modes with a visible permission matrix.
- A persistent operations queue and a progress window for every operation.
- Optional background service. Visual identity.

## 3.0.0 — 2026-10-28

First version: local registry, intent search, GitHub discovery, Claude Code integration and the macOS app.
