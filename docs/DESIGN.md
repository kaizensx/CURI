# CURI design system

CURI is a tool you work in, not a website, so the ambition shows as precision: earned familiarity, clear states, and one carefully made moment instead of decoration everywhere.

## Principles
- **Every row does something.** If CURI can't install, connect, add to a project or manage it, it doesn't show it.
- **State is never colour alone.** Presence uses a single vocabulary, always with a label: installed and configured (presence green), in your claude.ai account (ring), available (signal blue), for projects (neutral).
- **No labels above headings.** The heading carries its own weight.
- **Mono only for code, commands and data.** Never as a "technical" costume.
- **One authored moment.** The Home header: a slow ambient field (adapted from HorizonX's "Phosphor Flow" shader, exported through its MCP server) behind the constellation of your agents and capability areas. Nothing else animates on entry. Reduced motion turns it off.

## Foundations (`app/app.css`, `app/world.css`)
| Group | Tokens | Rule |
|---|---|---|
| Surfaces | `--bg-0 … --surface-4` | A graphite stack; each step a measured lift. |
| Lines | `--hairline`, `--hairline-2/3` | Light on dark, not grey boxes. |
| Ink | `--ink-1 … --ink-4` | Text never uses a series colour. |
| Signal | `--signal`, `--signal-wash` | Focus, selection and primary actions only. |
| Presence | `--presence`, `--one-step` | Installed vs. one step away. |
| Type | Geist, Geist Mono (bundled, OFL) | Headings 28/640 with −0.032em tracking; body 13.5. |
| Motion | `--ease-out (.23,1,.32,1)`, 140–280 ms | Nothing in the UI above 300 ms; no animation on keyboard actions. |

Light theme: the same token names with their own values; it follows the system or can be forced in Settings.

## Information architecture
Home · Library (filter rail, list or grid, resource sheet) · Discover (install-first cards) · Capabilities (areas with progress rings, dense rows) · This device (agents, base tools, package managers) · Connections · Activity and Settings with tabs.

## Skills and tools used to build it
Impeccable (direction and checks: Operate mode, the bans, browser surfaces), Emil Kowalski's design engineering (curves, durations, no second confirmation after a click the policy already covers), the dataviz skill (form and colour of the constellation and rings), and the HorizonX MCP server (the ambient shader).
