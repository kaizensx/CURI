# Marca CURI

## Conceitos explorados

| Conceito | Ideia | Avaliação |
|---|---|---|
| A — Lodestar | Estrela de navegação de quatro pontas; a ponta leste é a descoberta. | Legível e forte, mas a estrela de quatro pontas está muito associada a "IA/brilho". Rejeitado por genericidade. |
| **B — Aperture** (escolhido) | Três arcos concêntricos que formam um C, um radar e uma abertura de lente; o ponto no limite exterior é o recurso encontrado. | Liga diretamente ao radar do produto; original; escala bem (variante de dois anéis abaixo de 64 px); funciona a uma cor. |
| C — Index | Placas de índice desalinhadas com um diamante, como um "i" de registo. | Coerente com "registo", mas lê-se como um ícone de lista/menu. Rejeitado por falta de memorabilidade. |

Ficheiros: `brand/concepts/`.

## Símbolo "Aperture"
Geometria (grelha 512): arcos de raio 204/140/76, espessura 38, aberturas de ±36°/±50°/±68° voltadas a leste (abrem para dentro, dando profundidade); ponto de raio 24 no limite do arco exterior. Variante pequena (≤ 64 px): dois anéis, raio 186/86, espessura 64, ponto 40. A geometria vive apenas em `brand/build.mjs`; a app usa a mesma em `app/lib/icons.js`.

## Letras
"CURI" desenhado à medida: monolinha geométrica, altura 100, traço 15, terminais redondos, espaçamento 26. O C das letras repete a abertura do símbolo. Sem fontes de terceiros.

## Cor
| Nome | Hex | Uso |
|---|---|---|
| Grafite 900 / 800 / 700 | `#0e0f12` `#15171b` `#1d1f25` | Fundos |
| Prata (gradiente) | `#f5f7fb` → `#9aa2b2` | Símbolo e letras sobre escuro |
| Tinta | `#16181d` | Símbolo e letras sobre claro |
| Sinal | `#5c8ff0` (ícone: `#9cbcff`) | O ponto; foco e ação primária na app |

O azul aparece **só** no ponto e em ações primárias. Nunca gradientes roxos, néon ou brilho para decorar.

## Tipografia
SF Pro (texto e títulos) e SF Mono (micro-rótulos em maiúsculas, números). Na web, a pilha do sistema.

## Uso
- Margem livre mínima: metade do diâmetro do arco interior à volta do símbolo.
- Tamanho mínimo: 16 px (variante pequena).
- Não rodar, não esticar, não mudar a ordem das aberturas, não mudar a cor do ponto para fora da paleta.
- Sobre fundos fotográficos, usar a versão monocromática.

## Ativos
| Ficheiro | Para |
|---|---|
| `logo/curi-symbol-*.svg`, `logo/curi-symbol*.pdf` | Símbolo (vetor), cores e monocromático |
| `logo/curi-lockup-horizontal-*.svg`, `.pdf` | Logótipo horizontal |
| `logo/curi-lockup-compact-*.svg` | Logótipo compacto |
| `logo/curi-wordmark-*.svg` | Só letras |
| `export/CURI.icns`, `export/app-icon-*.png` | Ícone macOS (16–1024) |
| `export/favicon*.png`, `export/favicon.svg` | Web |
| `export/github-avatar-*.png` | Avatar GitHub |
| `export/github-social-preview.png` | Pré-visualização social (1280×640) |
| `export/readme-hero.png`, `export/release-banner.png` | README e releases |
| `export/dmg-background*.png` | Janela do DMG |

## Verificação feita
SVG sem imagens raster embutidas; PDF com caminhos vetoriais (arcos em Bézier); PNG com canal alfa e cantos transparentes; ícone inspecionado a 32 e 16 px. **Não foi feita pesquisa de marcas registadas**: antes de publicar, verificar "CURI" em bases como EUIPO/USPTO e o símbolo em pesquisa de imagens. Semelhança informal notada: arcos concêntricos lembram vagamente o símbolo de Wi-Fi, mas a forma fechada em C e a abertura lateral distinguem-no.
