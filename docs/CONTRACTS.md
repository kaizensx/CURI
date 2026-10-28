# Contracts between components

## Responsibilities

| Component | Does | Doesn't |
|---|---|---|
| **Shell (Rust, `desktop/`)** | Checks and installs dependencies into CURI's own folder, with progress; starts the Core; native menu; window state. | Doesn't touch the Claude profile or store data; the UI can't reach it over IPC (only window dragging). |
| **Core (Node, `core/`)** | The single source of truth: database, policy, operations queue, installers, detection, credential vault, local API, CLI, MCP server. | Never runs anything outside registered handlers; never exposes secrets. |
| **Interface (`app/`)** | Shows the real state and sends actions from a closed list (`core/src/api.mjs → ACTIONS`). | Holds no source of truth (only visual preferences in `localStorage`). |
| **Background service** | Periodic `curi daemon --once`: resumes interrupted work, runs approved or policy-covered operations, runs the maintenance plan. | Never approves anything; follows the policy and "pause on battery". |
| **Claude Code** | Starts CURI's MCP server and any MCP servers you enable (through the launcher). | — |

## Requests and errors
- Interface → Core: `POST /api/<action>` with JSON; the response is `{ ok, data }` or `{ ok: false, error }` (HTTP 4xx). Bearer token, `Host` and `Origin` checked.
- Operations: `opPreview` (a decision with no side effects) → `opEnqueue` (`approved: true` when the user confirmed) → states `awaiting_approval | queued | running | verified | completed | failed | cancelled | blocked | rejected`. Progress through `stage` + `progress` (0–1, only when measurable).

## File ownership

| Path | Owner | CURI may |
|---|---|---|
| CURI's data folder (`~/Library/Application Support/CURI/`, `%APPDATA%\CURI`, `~/.local/share/curi`) | CURI | Anything (data, backups, runtime, logs) |
| `~/.claude/skills/<name>/` with `.curi-managed.json` | CURI | Install, update, move to backups |
| `~/.claude/skills/<name>/` without the marker | You | Read and scan; **never** write |
| `~/.claude.json` → `mcpServers.<name>` created by CURI | CURI (through `claude mcp add/remove`) | Add/remove only those entries, checking the others didn't change |
| The rest of `~/.claude.json`, `~/.claude/settings.json`, `CLAUDE.md` | You / Claude Code | Read; back up before changes; **never** rewrite |
| Claude Code plugins | Claude Code | Install, enable, disable, update, uninstall through `claude plugin` |
| Other agents' configuration (Codex, Cursor, Gemini CLI, Windsurf, VS Code, Claude Desktop) | Each agent | Read only |
| Packages installed through Homebrew, npm, uv, pipx, Cargo, WinGet, Scoop, Flatpak | The package manager | Install, upgrade, remove through the manager, verified by its own listing |
| Your projects | You | Add a dependency with the project's own package manager, only when you ask |
| `~/Library/LaunchAgents/app.curi.agent.plist` | CURI | Create/remove with approval |
| `/usr/local/bin/curi` | CURI (admin action) | Create the link through the system dialog |
| System vault, service `app.curi.credentials` | CURI | Store/read/delete its own entries only |

## Integration support levels

| Integration | Level | Check |
|---|---|---|
| Claude Code CLI 2.1.309–2.1.312 | Supported and tested | `claude auth status`, `claude mcp list`, `claude plugin list`, optional real request |
| Skills from GitHub repositories | Supported and tested | Pinned commit, checksums, frontmatter, static scan |
| Claude Code plugins | Supported; tested against a scripted CLI | `claude plugin list --json` after every step |
| MCP servers (stdio via npx/uvx, HTTP) | Supported; Context7 tested with the real Claude | `claude mcp list` |
| Homebrew packages | Supported and tested (install and removal on a real machine) | The manager's own listing |
| npm, uv, pipx, Cargo, WinGet, Scoop, Flatpak | Implemented; same mechanism, not individually tested | The manager's own listing |
| GitHub, Anthropic, OpenAI, Google (keys) | Supported; invalid-key path tested against real GitHub | A read request to the provider |
| Windows / Linux | Implemented, **not yet tested** on real machines | — |

## Persistence and recovery
Versioned SQLite schema (v5) with a copy before every migration; an older client refuses to open a newer database. The operations queue resumes `running` work as `queued` after a restart; handlers are idempotent (for example, a skill with the same commit and checksums means nothing to do).
