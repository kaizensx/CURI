# Changelog

## 3.4.0 - 2026-10-28

- Recently added: one timeline across Claude Code, your claude.ai account, the other agents and this computer, newest first, filtered by place and period. Also on Home.
- Back and forward arrows (and ⌘[ / ⌘]) with a breadcrumb showing where you are.
- Pages instead of endless "show more" in the Library, Discover, Activity and the audit log.
- Things you already have are never offered as an install. Skills named after their project (and account skills that link to their repository) are now recognised, so recommendations skip them, and a resource you have says where it is.
- Sidebar entries say what each place is for, and Home opens with three plain starting points.
- New README with a tour of every screen.
- Library › Installed: everything that's already here, grouped by where it lives: your claude.ai account, Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI and this computer (apps and packages). Search across all of it, and manage it from there.
- This device is now an overview: the system, each agent with what it holds, base tools and package managers. Every number opens the matching list.
- After an install, removal or toggle, CURI looks at the device again before the progress window closes, so the change shows up straight away. Discover shows what's already installed instead of offering it again.
- The progress bar follows what the package manager actually reports and only ever moves forward.
- Fixed: the Home background went blank after switching away and back; the GitHub card in Connections flickered.

## 3.3.0 - 2026-10-28

- Everything is in English now: the app, the native menu, the engine's messages, the code and the docs.
- Discover only shows what CURI can actually install. Each discovery is inspected (manifests, README, registry checks) and gets a one-click **Install**, which also installs a missing prerequisite first when that's all that stands in the way.
- The Library only lists resources CURI can act on: install, connect, add to a project, or manage what's already there.
- Libraries and frameworks can be added straight to one of your projects with its own package manager (npm, pnpm, yarn, bun or uv), and the result is checked in the manifest.
- Your own layer on top of the catalogue: favourites, collections, notes, your own kind and project command, hiding things.
- Redesigned Library (list or grid, sorting, more filters, bulk actions), Discover (install-first cards, saved searches that can run on their own), Capabilities (areas with progress rings and dense rows) and This device.
- An ambient field on Home, adapted from a HorizonX shader.
- Fixed: the sidebar sat under the macOS window buttons and never showed the native material.

## 3.2.0 - 2026-10-28

- New navigation: Home, Library, Discover, Capabilities, This device, Connections, Activity and Settings.
- Every starter seed was inspected; each resource has its real kind and real install options per operating system.
- Detection across Claude Code, Claude Desktop, your claude.ai account, Codex, Cursor, Gemini CLI, Windsurf and VS Code.
- Real actions: package managers, Claude Code plugins, MCP servers.
- Capabilities in plain language, decision-oriented comparisons, agent-relevance ranking for discoveries, GitHub stars.
- Automatic maintenance within the autonomy mode you choose.
- Groundwork for Windows and Linux (implemented, not yet tested on those systems).

## 3.1.0 - 2026-10-28

- Claude Code sign-in without a terminal.
- Connections to GitHub, Anthropic, OpenAI and Google, with keys in the system vault.
- Autonomy modes with a visible permission matrix.
- A persistent operations queue and a progress window for every operation.
- Optional background service. Visual identity.

## 3.0.0 - 2026-10-28

First version: local registry, intent search, GitHub discovery, Claude Code integration and the macOS app.
