// Agent relevance: would this repository genuinely extend what an AI agent can do? Judged from how an
// agent could reach it (MCP server, skill/plugin, CLI, API/SDK, scriptable application, library) and
// which professional domain it opens, independent of whether the project advertises "AI". Noise
// (lists, tutorials, dotfiles, prompt dumps, trading bots…) is filtered with a stated reason.
const RX = (s) => new RegExp(s, 'i');
const INTERFACES = [
  ['mcp', 1.0, RX('\\bmcp\\b|model context protocol|mcp[-_ ]server'), 'O agente chama as ferramentas deste servidor MCP diretamente.'],
  ['plugin', 0.9, RX('claude[- ]code plugin|plugin marketplace|\\.claude-plugin'), 'Instala-se como plugin do Claude Code.'],
  ['skill', 0.9, RX('agent[- ]skills?|claude[- ]skills?|skill\\.md|skills for (claude|codex|agents)|\\bclaude code\\b'), 'O agente carrega estas skills quando a tarefa corresponde.'],
  ['computer-use', 0.85, RX('computer[- ]use|browser automation|headless browser|desktop automation|gui automation|accessibility tree'), 'Dá ao agente controlo de browser, ecrã ou aplicações.'],
  ['cli', 0.7, RX('\\bcli\\b|command[- ]line|terminal (tool|app|ui)|\\btui\\b'), 'O agente executa-a no terminal e lê o resultado.'],
  ['scriptable-app', 0.65, RX('headless|scripting api|python api|automat(e|ion) (blender|cad|kicad|freecad|ghidra|ida)|add-?on api|plugin api|rest api for'), 'Aplicação com interface programável que o agente pode conduzir.'],
  ['api', 0.55, RX('\\bsdk\\b|\\bapi\\b|bindings|python (library|package)|client library|rest|graphql'), 'O agente usa-a em código através da API/SDK.'],
  ['library', 0.45, RX('\\blibrary\\b|\\bframework\\b|\\bengine\\b|toolkit|\\bparser\\b|\\bcompiler\\b|\\bsolver\\b'), 'Biblioteca que o agente usa ao escrever código.'],
  ['ui', 0.35, RX('react components?|\\bfor react\\b|swiftui|jetpack compose|compose multiplatform|flutter (package|widget)|ui (kit|library|components)|tailwind|shadcn|design system|css animation|component library'), 'Componentes de interface para o agente usar ao construir UIs.'],
];
// Professional domains where agents become meaningfully more capable (cross-domain discovery).
const DOMAINS = [
  ['3D e gráficos', RX('\\b3d\\b|blender|gltf|mesh|point cloud|gaussian splat|nerf|shader|webgpu|webgl|three\\.js|render(er|ing)')],
  ['CAD e fabrico', RX('\\bcad\\b|freecad|openscad|kicad|pcb|cnc|g-?code|3d print|slicer|step file|parametric')],
  ['Vídeo e áudio', RX('video|ffmpeg|audio|speech|tts|text[- ]to[- ]speech|transcri|whisper|music|subtitle|voice')],
  ['Segurança', RX('security|pentest|vulnerab|exploit|fuzz|\\bcve\\b|malware|osint|secrets? scan|sast|dast')],
  ['Engenharia reversa', RX('reverse engineer|decompil|disassembl|binary analysis|ghidra|\\bida\\b|radare|rizin|firmware|frida|debugger')],
  ['Ciência e dados', RX('bioinformatic|chemistr|molecul|protein|genom|physics|scientific|astronom|climate|\\bgis\\b|geospatial|satellite|dataset|dataframe|notebook')],
  ['Hardware e robótica', RX('robot|\\bros2?\\b|embedded|microcontroller|arduino|esp32|fpga|drone|serial port|iot|home assistant')],
  ['Documentos', RX('\\bpdf\\b|docx|excel|spreadsheet|ocr|markdown convert|document (parsing|extraction)')],
  ['Web e browser', RX('browser|scrap|crawl|playwright|puppeteer|selenium|web automation')],
  ['Dados e bases de dados', RX('database|\\bsql\\b|postgres|sqlite|vector (db|database|store)|embedding|search engine|etl')],
  ['Desenvolvimento', RX('code review|refactor|lint|static analysis|testing|debug|ci/cd|devops|kubernetes|docker|git\\b')],
  ['Design e UI', RX('design|figma|\\bui\\b|ux|animation|motion|typography|icon')],
  ['Agentes e memória', RX('\\bagents?\\b|multi-agent|memory|\\brag\\b|context (engineering|window)|tool[- ]use|orchestrat|workflow')],
];
const NOISE = [
  ['Lista curada (não é uma ferramenta)', RX('^awesome[-_ ]|\\bawesome list\\b|curated list|list of (awesome|resources|tools)|collection of (links|resources)')],
  ['Material de aprendizagem', RX('tutorial|\\bcourse\\b|roadmap|interview|cheat ?sheet|\\bbook\\b|learning path|\\bfrom scratch\\b|study notes|homework|leetcode|exercises|bootcamp|workshop')],
  ['Configuração pessoal', RX('dotfiles|my (config|setup|portfolio|blog)|personal (website|site|config)|resume|\\bcv\\b')],
  ['Coleção de prompts', RX('prompts? (collection|library|list)|system prompts? (leak|collection)|jailbreak|awesome prompts')],
  ['Bots especulativos', RX('airdrop|sniper bot|pump\\.fun|trading bot|memecoin|crypto signal')],
  ['Clone/wrapper genérico', RX('chatgpt clone|clone of chatgpt|gpt wrapper|chat ui clone')],
];

// Topics are noisy (projects tag themselves with everything); description and name decide, and topics
// only count when they name an agent interface explicitly.
const textOf = c => [c.name?.replace(/[-_]/g, ' '), c.description].filter(Boolean).join(' · ');
const EXPLICIT_TOPICS = new Set(['mcp-server', 'model-context-protocol', 'mcp-servers', 'claude-skills', 'agent-skills', 'claude-code-plugin', 'cli', 'command-line-tool']);
const topicText = c => (c.topics || []).filter(t => EXPLICIT_TOPICS.has(t)).join(' ').replace(/-/g, ' ');

export function agentRelevance(c, { ref = new Date() } = {}) {
  const text = textOf(c);
  const why = [];
  if (c.fork) return { score: 0, noise: 'Fork de outro repositório', interface: null, domains: [], why };
  if (c.archived) return { score: 0, noise: 'Repositório arquivado', interface: null, domains: [], why };
  if (!c.description || c.description.trim().length < 12) return { score: 0, noise: 'Sem descrição útil', interface: null, domains: [], why };
  for (const [reason, rx] of NOISE) if (rx.test(text)) return { score: 0, noise: reason, interface: null, domains: [], why };
  let iface = null, ifaceScore = 0, how = null;
  const itext = `${text} ${topicText(c)}`;
  for (const [id, w, rx, h] of INTERFACES) if (rx.test(itext) && w > ifaceScore) { iface = id; ifaceScore = w; how = h; }
  const domains = DOMAINS.filter(([, rx]) => rx.test(text)).map(([d]) => d);
  // A specialised domain makes a CLI/API/app far more interesting to an agent than a generic one.
  const specialised = domains.some(d => !['Desenvolvimento', 'Design e UI', 'Agentes e memória'].includes(d));
  let utility = ifaceScore + (specialised && ifaceScore >= 0.45 ? 0.15 : 0) + (domains.includes('Agentes e memória') && ifaceScore < 0.9 ? 0.1 : 0);
  if (!iface && specialised) { utility = 0.3; how = 'Projeto de um domínio especializado; o agente só o usa se tiver interface programável.'; }
  utility = Math.min(1, utility);
  if (iface) why.push(`Interface: ${iface}`);
  if (domains.length) why.push(`Domínio: ${domains.slice(0, 2).join(', ')}`);
  // Momentum and upkeep (evidence from GitHub, not guesses).
  const ageDays = c.created_at ? Math.max(1, (ref - new Date(c.created_at)) / 864e5) : null;
  const sincepush = c.pushed_at ? (ref - new Date(c.pushed_at)) / 864e5 : null;
  const perDay = ageDays && c.stars != null ? c.stars / ageDays : null;
  const momentum = perDay == null ? 0.3 : Math.min(1, Math.log10(1 + perDay) / 1.5);
  const upkeep = sincepush == null ? 0.3 : sincePush(sincepush);
  if (perDay != null && ageDays < 180 && perDay >= 3) why.push(`Emergente: ~${Math.round(perDay)} estrelas/dia`);
  const license = c.license && c.license !== 'none' && c.license !== 'NOASSERTION' ? 1 : 0.3;
  const score = Math.round((0.55 * utility + 0.2 * momentum + 0.15 * upkeep + 0.1 * license) * 1000) / 1000;
  return { score, utility: Math.round(utility * 100) / 100, interface: iface, how, domains, emerging: perDay != null && ageDays < 180 && perDay >= 3, why, noise: utility < 0.3 ? 'Sem ligação clara a capacidades de agentes' : null };
}
const sincePush = d => (d < 30 ? 1 : d < 90 ? 0.8 : d < 365 ? 0.5 : 0.15);
export const RELEVANCE_DOMAINS = DOMAINS.map(([d]) => d);
