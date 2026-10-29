# Changelog

## 3.8.0 - 2026-10-29

**Updates arrive on their own**
- CURI checks GitHub for a new version shortly after launch and every six hours. When there's one, it says so in the menu bar or tray, with a notification and a banner in the window: *What's new*, *Later* or *Install and restart*.
- Updates are signed with CURI's own release key and checked before anything is installed; a download that doesn't match is refused, CURI keeps the version you have and doesn't offer that download again.
- Installing downloads the update, replaces the app and restarts it in a few seconds, on macOS, Windows and the Linux AppImage. With a `.deb` install, *Install* opens the release page instead.
- An update downloaded by CURI itself doesn't get the unsigned-app warning, so people only see that once, on the first install.
- *Check for Updates…* in the menu bar or tray, and *Check* in Settings › About, look right away.

**Releases**
- A version tag now also builds the signed update files and a `latest.json` for installed copies, with the CHANGELOG section as the *What's new* text. Release notes include the install commands.

## 3.7.0 - 2026-10-29

CURI now runs on Windows and Linux, tested on real machines: Windows 11 (x64) and Ubuntu 24.04 (ARM).

**First launch on a clean machine**
- On Windows the first-launch installer works: it downloads Node (checked against the official SHA-256), installs the Claude Code CLI, and uses the real `claude.exe` rather than npm's `.cmd` shim. Before, it only knew macOS and Linux paths and couldn't get past the first launch.
- No black console window next to the app on Windows: every process CURI starts is created without one.
- The app and the engine keep their data in the same place on every OS (`%APPDATA%\CURI` on Windows, `~/.local/share/curi` on Linux).
- The catalogue is there from the first launch, so "Explore in read-only mode" shows 220 real resources before setup. This also applies to macOS.

**Feels native on each system**
- Windows and Linux keep their own window frame; the macOS menu bar and title-bar spacing are macOS-only.
- Shortcut labels say Ctrl outside macOS, and copy says "this computer" instead of "this Mac".
- The tray icon uses the colour icon off macOS; "Open at Login" uses the Run key on Windows and an autostart entry on Linux.
- Opening CURI while it's already running brings the window back instead of starting a second copy (and a second engine on the same database).
- On screens smaller than the default window, CURI opens maximised; the narrow sidebar collapses cleanly.

**Works without extra tools**
- Skills install without git: the commit comes from GitHub when git isn't there (fresh Windows, or a Mac without the Command Line Tools).
- Fixed: the "Open at Login" default was re-applied on every launch of a brand-new install, even after turning it off.

**Builds**
- A manual "Cross-platform build" workflow produces the Windows installer and Linux packages (x64 and ARM) for testing.
- A version tag now builds macOS, Windows and Linux into one draft release, with `SHA256SUMS` and this changelog as the notes. The old release notes were still in Portuguese.
- README: install steps for each system and real screenshots from all three.
- One-line install on every system: `curl -fsSL …/install.sh | sh` on macOS and Linux, `irm …/install.ps1 | iex` on Windows. Each finds the latest release, checks it against `SHA256SUMS`, installs and opens CURI, without the unsigned-app warnings a browser download gets. Tested on macOS, Windows 11 and Ubuntu ARM.

## 3.6.2 - 2026-10-29

- CI runs again, and for real: the test command passed a folder to `node --test`, which the Node version CI uses doesn't accept, so no test had run there for a while.
- The engine's tests now pass on macOS, Linux and Windows, and all three are required.
- Windows: skills install (CURI used `/usr/bin/tar`, which Windows doesn't have), and an older CURI entry in Claude Code's config is recognised with Windows paths instead of being reported as a conflict.
- Linux: the credential vault is tested against a real Secret Service keyring.
- The background service and the `/usr/local/bin` link are macOS-only; on other systems they show as unavailable with the reason, instead of failing halfway.

## 3.6.1 - 2026-10-29

- Discover, Capabilities and Installed filters now behave as toggle buttons for screen readers, like the catalogue.
- Settings calls the history page "Activity", same as the sidebar.
- CI runs the engine tests on Linux and Windows as well as macOS. macOS still decides whether a build passes; the other two show where the engine still needs work there.
- Checked in the real window this time: window buttons sit inside the sidebar, edges are clean, and nothing grey shows around the window.

## 3.6.0 - 2026-10-29

A full pass over security, reliability and accessibility before more people use CURI.

**Security**
- Packages from npm or PyPI no longer count as "verified" just because their registry entry names the project's repository: anyone publishing can write that. Only curated entries and npm packages with signed build provenance do. The publisher and provenance are now worked out by CURI from its own data, never taken from the install request. In practice, a look-alike package can no longer install without asking.
- After you approve a skill that contains scripts, CURI installs exactly the commit it scanned and showed you. If the publisher pushes something new in between, the install stops instead of installing unreviewed code.
- Source checks only reach public addresses, re-checked on every redirect, and skip resources an agent suggested until you review them.
- Component names taken from a project's README must be plain registry names before CURI adds them to a project.

**Fixes**
- Catalogue search shows an error with "Try again" when it fails, instead of quietly listing the whole catalogue as results.
- Automatic maintenance: the skills and plugins update intervals were one setting, so one silently overwrote the other; they're now separate. Values out of range are clamped instead of making Save fail.
- Home, Discover and the command palette show a real error when something fails, instead of "nothing found".
- Long text in search and comparison fields can no longer break those pages; notes that fail to save now say so.
- Every remaining Portuguese string is now in English, including progress steps, badges and first-launch messages.
- The Activity page is called Activity, About shows the real version, and the Compare and "Hidden" hints describe how the app works today.

**Accessibility**
- Text and buttons meet WCAG AA contrast in both themes, including white labels on blue buttons.
- Every catalogue card has a ⋯ button with the actions that used to be right-click only, and cards open with Enter or Space.
- Filters behave as toggle buttons for screen readers; result counts are announced once, and errors are announced right away.
- The command palette, menus, dialogs and the install window keep focus where it belongs and give it back when they close.
- Reduced motion now stops transitions too, and "Reduce transparency" or "Increase contrast" in macOS give solid, high-contrast surfaces.
- The kind filter scrolls instead of being cut off in narrow windows; the catalogue search has a clear focus ring.

## 3.5.3 - 2026-10-29

- Fixed: the back and forward arrows didn't respond. The invisible strip that lets you drag the window was sitting on top of them since the glass update; it now sits underneath, so empty space still drags the window and the arrows work.
- The window buttons (close, minimise, zoom) now sit properly inside the sidebar instead of on its top edge.
- No more grey system blur showing at the window's edges, and a thinner scrollbar so the right edge doesn't show a band.

## 3.5.2 - 2026-10-29

- New sidebar that matches the rest of the app: a floating pane of glass over the same colour field, instead of the grey system sidebar.
- Each section's icon sits in a small tile, and the current one lights up in blue inside a glass capsule.
- Wider, so the short descriptions under each section fit; the status at the bottom is its own small card.
- Fresh screenshots.

## 3.5.1 - 2026-10-29

- ⌘Q, the Dock's "Quit" and the app menu now send CURI back to the menu bar instead of closing it. "Quit CURI" in the menu bar icon is the only way to stop it.
- Logging out, restarting and shutting down are never held up: macOS marks those quits, and CURI lets them through.
- If CURI crashes, it comes back on its own (when "Open at Login" is on). Quitting from the menu bar keeps it closed.

## 3.5.0 - 2026-10-29

**Lives in the menu bar**
- Closing the window hides it; CURI keeps running with an icon in the menu bar and drops out of the Dock until you open it again.
- The menu shows what's going on ("Up to date · checked 4 min ago", "2 things need your OK"), with Open CURI, Check Now, Activity, Open at Login and Quit CURI.
- Opens at login, hidden, through a user LaunchAgent (no admin rights). Untick "Open at Login" to turn it off for good.
- Notifications when an install finishes or fails, when something waits for your OK, and when new suggestions show up. Only while the window isn't in front.
- The Core reports its status to the shell on stdout and takes commands on stdin, so none of this opens a new port.

**A new catalogue, and the Library opens on it**
- Big search up top, ideas to try, areas as a scrolling strip, and kinds as one segmented control.
- Browsing shows featured cards and shelves: ready in one click, already yours, busy lately, and one per kind, each with "See all".
- Searching or filtering turns it into a grid with the filters that matter (show, collections, source, upkeep, sort). The headline steps aside while you search.
- Every resource gets its own icon colour, and every card says whether it's yours ("Open") or what gets it here ("Get", "Add to project").
- Fixed: catalogue search asked the engine for more results than it allows and quietly showed everything instead of the matches.

**Glass**
- A slow field of colour behind the content, tinted per section, with translucent glass surfaces on top: blur, a light rim on the top edge and a highlight that follows the pointer.
- Capsule buttons, tabs and search fields; bigger, tighter headings; the top bar blurs what scrolls under it.
- Respects reduced motion and light mode.

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
