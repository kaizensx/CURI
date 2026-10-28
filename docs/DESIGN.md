# CURI — sistema de design

## 3.2 — mundo "Aperture" (`app/world.css`, sobre as fundações Instrument)
- **Modo:** ferramenta (Operate). A ambição está na precisão: nada de rótulos por cima dos títulos, nada de monoespaçada como enfeite (só para código, comandos e dados), grelhas de cartões só onde os dados são de facto uma grelha.
- **Tipo:** Geist e Geist Mono alojadas na app (OFL); títulos 28/640 com tracking −0,032 em; corpo 13,5.
- **Presença:** vocabulário único de estado — instalado/configurado (verde de presença), na conta (anel), disponível (sinal azul), para projetos e referência (neutro). Sempre com rótulo.
- **Momento assinado:** a constelação do Início (agentes no anel interior, áreas de capacidade em arcos; verde = disponível, azul = a um passo). Os arcos desenham-se uma vez ao abrir; nada mais anima à entrada. Desligado com movimento reduzido.
- **Arquitetura:** Início · Biblioteca (barra de filtros + lista densa + ficha) · Descobrir · Capacidades · Este dispositivo · Ligações · Atividade e Definições com separadores.
- **Recursos do ecossistema usados:** Impeccable (direção e verificação: modo Operate, proibições, superfícies do browser), Emil Kowalski (curvas, durações, sem segunda confirmação após um clique coberto pela política), dataviz (forma e cor da constelação e das barras de domínio).

## Fundações "Instrument"

Uma ferramenta de engenharia, não um site: precisão, contenção, profundidade. Base grafite, filetes de luz em vez de caixas cinzentas, um único acento azul-aço, materiais translúcidos só onde há camadas reais, movimento curto e com propósito.

## Fundações (`app/app.css` §1)
| Grupo | Tokens | Regra |
|---|---|---|
| Superfícies | `--bg-0 … --surface-4` | 6 degraus medidos; cada nível sobe ~6 % de luminância. |
| Linhas | `--hairline`, `--hairline-2/3`, `--rim`, `--highlight` | Luz sobre escuro; o painel tem um aro com gradiente vertical (luz de cima). |
| Tinta | `--ink-1 … --ink-4` | Texto nunca usa a cor de uma série. |
| Sinal | `--signal`, `--signal-strong`, `--signal-wash` | Só foco, seleção e ação primária. |
| Estado | `--good / --warn / --serious / --bad` (+ `-wash`) | Reservados; sempre com ícone e rótulo. |
| Categórica | `--cat-1…4` | Validada com o validador da skill *dataviz* (dark: tudo PASS; light: aviso de contraste → rótulos diretos + vista em tabela). |
| Sequencial | `--seq-0…4` | Um só matiz; em escuro, mais = mais claro. |
| Tipo | SF Pro Text/Display, SF Mono; escala 10.5 → 40 px | Micro-rótulos em mono maiúsculo; números tabulares. |
| Espaço / raio | grelha 4 pt; raios 5/7/10/14/18 | |
| Movimento | `--ease-out (.23,1,.32,1)`, `--ease-in-out`, `--ease-drawer`; 140/160/220/280 ms | Nada de UI acima de 300 ms. |

Tema claro: mesmos nomes de tokens, valores próprios; segue o sistema ou é forçado em Definições.

## Materiais
- **Painel** (`.panel`): superfície opaca + aro de luz mascarado (sem borda cinzenta).
- **Vidro** (`--glass` + `backdrop-filter`): só paleta de comandos, menus de contexto, toasts, tooltips e barra lateral no browser. Na app nativa a barra lateral é transparente e mostra o material `sidebar` do macOS.

## Primitivos (`app/lib/ui.js`)
`btn` (assíncrono: desfoca o rótulo e mostra spinner sem mudar o tamanho), `linkBtn`, `status` (vocabulário único de estados → cor + ícone + rótulo PT), `badge`, `panel`, `pageHead`, `empty`, `notice`, `skeleton`, `table`, `kv`, `meter` (só rácios reais), `segmented`, `toggle`, `confirmDialog`/`promptDialog` (substituem `confirm()`/`prompt()`, que um webview pode não implementar), `contextMenu` (origem no cursor, setas, Esc), `tooltip` (atraso no primeiro, instantâneo nos seguintes), `toast` (pausa com o rato por cima e com a janela oculta), `externalLink` (abre no browser por ação validada do Core).

## Gráficos (`app/lib/charts.js`)
- **Radar de fronteira** (assinatura): polar; setor = estratégia de pesquisa, raio = pontuação (centro = 1.0; anel exterior = sem pontuação), tamanho = estrelas no momento da captura, oco = já no registo. Varrimento decorativo de 9 s, desligado com movimento reduzido.
- **Cobertura por domínio**: barras horizontais com recursos distintos e a parte verificada sobreposta, num só eixo.
- **Mapa de capacidades**: mosaicos com escala sequencial e rótulo numérico (a cor nunca é a única pista).

## Movimento — decisões
| Interação | Animação | Porquê |
|---|---|---|
| Paleta ⌘K, atalhos ⌘1–9 | nenhuma | usada dezenas de vezes por dia |
| Mudança de página por clique | View Transition 220 ms ease-out | continuidade espacial |
| Indicador da navegação | translate 280 ms ease-out | mostra de onde para onde |
| Cartões / listas | entrada escalonada 18–40 ms | revela hierarquia, nunca bloqueia |
| Botões, chips, cartões | `scale(.97)` ao premir | confirma que ouviu |
| Diálogos, menus, toasts | `@starting-style`, transições interrompíveis | sem keyframes em UI dinâmica |
| Movimento reduzido | transformações removidas, opacidade mantida | acessibilidade |

## Nativo (macOS)
Barra de título sobreposta com semáforos a (18, 22), material `sidebar` com vibrancy, menu nativo PT-PT (CURI, Ficheiro, Editar, Ver, Janela, Ajuda) ligado à UI, tamanho/posição da janela persistidos, arrastar-e-largar de URLs, menus de contexto próprios, texto da interface não selecionável (conteúdo sim).

## Recursos usados
Encaminhados pelo próprio CURI (`curi search`): Emil Kowalski skills (aplicada: curvas, durações, frequência→animação, Sonner), Web Interface Guidelines, Impeccable, UI/UX Pro Max (catalogados; referência), Apple HIG (materiais e janela). Skill *dataviz* aplicada para forma, paleta validada e anatomia dos gráficos. Bibliotecas de componentes do catálogo (React Bits, Magic UI, Aceternity, shadcn…) **não** foram usadas: a UI não é React e a CSP proíbe origens externas — extraíram-se padrões, não código.
