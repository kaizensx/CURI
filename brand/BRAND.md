# CURI brand

## Concepts explored

| Concept | Idea | Verdict |
|---|---|---|
| A — Lodestar | A four-point navigation star; the east point is discovery. | Legible and strong, but the four-point star is heavily associated with "AI sparkle". Rejected as generic. |
| **B — Aperture** (chosen) | Three concentric arcs forming a C, a radar sweep and a lens aperture; the dot on the outer edge is the resource you found. | Connects directly to discovery; original; scales well (a two-ring variant under 64 px); works in one colour. |
| C — Index | Offset index cards with a diamond, like a registry "i". | Fits "registry", but reads as a list/menu icon. Rejected as forgettable. |

Files: `brand/concepts/`.

## The "Aperture" symbol
Geometry (512 grid): arcs of radius 204/140/76, stroke 38, openings of ±36°/±50°/±68° facing east (opening inwards, which gives depth); a dot of radius 24 on the outer arc's edge. Small variant (≤ 64 px): two rings, radius 186/86, stroke 64, dot 40. The geometry lives only in `brand/build.mjs`; the app uses the same in `app/lib/icons.js`.

## Lettering
"CURI" is custom-drawn: geometric monoline, height 100, stroke 15, round terminals, spacing 26. The C repeats the symbol's opening. No third-party typefaces.

## Colour
| Name | Hex | Use |
|---|---|---|
| Graphite 900 / 800 / 700 | `#0e0f12` `#15171b` `#1d1f25` | Backgrounds |
| Silver (gradient) | `#f5f7fb` → `#9aa2b2` | Symbol and lettering on dark |
| Ink | `#16181d` | Symbol and lettering on light |
| Signal | `#5c8ff0` (icon: `#9cbcff`) | The dot; focus and primary actions in the app |

Blue shows up **only** in the dot and in primary actions. Never purple gradients, neon or glow as decoration.

## Typography
The interface uses Geist and Geist Mono (bundled, OFL). Mono is for code, commands and data only.

## Usage
- Minimum clear space: half the inner arc's diameter around the symbol.
- Minimum size: 16 px (small variant).
- Don't rotate, stretch, reorder the openings, or move the dot's colour outside the palette.
- On photographic backgrounds, use the monochrome version.

## Assets
| File | For |
|---|---|
| `logo/curi-symbol-*.svg`, `logo/curi-symbol*.pdf` | Symbol (vector), colour and monochrome |
| `logo/curi-lockup-horizontal-*.svg`, `.pdf` | Horizontal logo |
| `logo/curi-lockup-compact-*.svg` | Compact logo |
| `logo/curi-wordmark-*.svg` | Lettering only |
| `export/CURI.icns`, `export/app-icon-*.png` | macOS icon (16–1024) |
| `export/favicon*.png`, `export/favicon.svg` | Web |
| `export/github-avatar-*.png` | GitHub avatar |
| `export/github-social-preview.png` | Social preview (1280×640) |
| `export/readme-hero.png`, `export/release-banner.png` | README and releases |
| `export/dmg-background*.png` | DMG window |

## Checks done
SVGs contain no embedded raster images; PDFs use vector paths (arcs as Béziers); PNGs have an alpha channel and transparent corners; the icon was inspected at 32 and 16 px. **No trademark search has been done yet**: before a public launch, check "CURI" in databases such as EUIPO/USPTO and the symbol in an image search. One informal similarity: concentric arcs loosely recall the Wi-Fi symbol, but the closed C shape and side opening set it apart.
