/**
 * JARVIS Terminal Logger
 * Color-coded, structured output for every system event
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[93m',
  red: '\x1b[31m',
  brightRed: '\x1b[91m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;214m',
  bg: {
    cyan: '\x1b[46m',
    green: '\x1b[42m',
    red: '\x1b[41m',
    blue: '\x1b[44m',
    black: '\x1b[40m',
  },
};

function ts() {
  return C.gray + new Date().toLocaleTimeString('en-US', { hour12: false }) + C.reset;
}

function tag(label: string, color: string) {
  return `${color}${C.bold}[${label}]${C.reset}`;
}

export const log = {
  banner(port: number) {
    console.log(`
${C.brightCyan}${C.bold}╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗                 ║
║     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝                 ║
║     ██║███████║██████╔╝██║   ██║██║███████╗                 ║
║██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║                 ║
║╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║                 ║
║ ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝                 ║
║                                                              ║
║  Just A Rather Very Intelligent System  ·  v2.0             ║
║  Stark Industries  ·  Port ${String(port).padEnd(5)}  ·  Phase 2            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);
  },

  check(label: string, ok: boolean, detail = '') {
    const icon = ok ? `${C.brightGreen}✓${C.reset}` : `${C.brightRed}✗${C.reset}`;
    const labelStr = ok ? `${C.green}${label}${C.reset}` : `${C.red}${label}${C.reset}`;
    const detailStr = detail ? `  ${C.gray}${detail}${C.reset}` : '';
    console.log(`  ${icon}  ${labelStr}${detailStr}`);
  },

  section(title: string) {
    console.log(`\n${C.brightCyan}${C.bold}  ── ${title} ${'─'.repeat(Math.max(0, 48 - title.length))}${C.reset}`);
  },

  tool(name: string) {
    console.log(`  ${C.cyan}⟐${C.reset}  ${C.white}${name}${C.reset} ${C.gray}registered${C.reset}`);
  },

  ready(port: number) {
    console.log(`
${C.brightGreen}${C.bold}  ● JARVIS ONLINE${C.reset}  ${C.gray}→${C.reset}  ${C.brightCyan}http://localhost:${port}${C.reset}  ${C.gray}|${C.reset}  ${C.brightCyan}ws://localhost:${port}/ws${C.reset}
${C.gray}  HUD: ${C.brightCyan}http://localhost:3001${C.reset}
`);
  },

  request(method: string, path: string, status: number, ms: number) {
    const methodColor = method === 'GET' ? C.brightBlue : method === 'POST' ? C.brightGreen : method === 'DELETE' ? C.brightRed : C.yellow;
    const statusColor = status < 300 ? C.brightGreen : status < 400 ? C.yellow : C.brightRed;
    console.log(`  ${ts()}  ${methodColor}${method.padEnd(6)}${C.reset}  ${C.white}${path.padEnd(35)}${C.reset}  ${statusColor}${status}${C.reset}  ${C.gray}${ms}ms${C.reset}`);
  },

  ws(event: string, detail = '') {
    console.log(`  ${ts()}  ${tag('WS', C.brightMagenta)}  ${C.magenta}${event}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  voice(event: string, detail = '') {
    console.log(`  ${ts()}  ${tag('VOICE', C.brightYellow)}  ${C.yellow}${event}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  vtt(text: string, durationMs: number) {
    console.log(`  ${ts()}  ${tag('VTT', C.brightYellow)}  ${C.white}"${text}"${C.reset}  ${C.gray}(${durationMs}ms)${C.reset}`);
  },

  tts(text: string, voice: string) {
    const preview = text.slice(0, 60) + (text.length > 60 ? '…' : '');
    console.log(`  ${ts()}  ${tag('TTS', C.brightYellow)}  ${C.yellow}${voice}${C.reset}  ${C.gray}"${preview}"${C.reset}`);
  },

  ai(event: string, detail = '') {
    console.log(`  ${ts()}  ${tag('AI', C.brightCyan)}  ${C.cyan}${event}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  tool_call(name: string, sessionId: string) {
    console.log(`  ${ts()}  ${tag('TOOL', C.orange)}  ${C.orange}${name}${C.reset}  ${C.gray}session=${sessionId}${C.reset}`);
  },

  tool_result(name: string, preview: string) {
    console.log(`  ${ts()}  ${tag('TOOL', C.orange)}  ${C.orange}${name}${C.reset}  ${C.gray}→ ${preview.slice(0, 80).replace(/\n/g, ' ')}${C.reset}`);
  },

  agent(event: string, id: string, detail = '') {
    console.log(`  ${ts()}  ${tag('AGENT', C.brightMagenta)}  ${C.magenta}${event}${C.reset}  ${C.gray}${id.slice(0, 8)} ${detail}${C.reset}`);
  },

  scheduler(event: string, detail = '') {
    console.log(`  ${ts()}  ${tag('SCHED', C.brightBlue)}  ${C.blue}${event}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  computer(action: string, detail = '') {
    console.log(`  ${ts()}  ${tag('COMP', C.brightGreen)}  ${C.green}${action}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  browser(action: string, detail = '') {
    console.log(`  ${ts()}  ${tag('BWSR', C.brightBlue)}  ${C.blue}${action}${C.reset}  ${C.gray}${detail}${C.reset}`);
  },

  error(source: string, message: string) {
    console.log(`  ${ts()}  ${tag('ERR', C.brightRed)}  ${C.red}${source}${C.reset}  ${C.brightRed}${message}${C.reset}`);
  },

  warn(source: string, message: string) {
    console.log(`  ${ts()}  ${tag('WARN', C.brightYellow)}  ${C.yellow}${source}${C.reset}  ${C.gray}${message}${C.reset}`);
  },

  info(message: string) {
    console.log(`  ${ts()}  ${C.gray}${message}${C.reset}`);
  },

  wakeWord(word: string, transcript: string) {
    console.log(`  ${ts()}  ${tag('WAKE', C.brightYellow)}  ${C.brightYellow}${C.bold}"${word}"${C.reset}  ${C.white}→ "${transcript}"${C.reset}`);
  },
};
