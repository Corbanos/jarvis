/**
 * JARVIS's knowledge of its own source and deployment.
 *
 * The shell and filesystem tools already let agents read and edit any file;
 * what they lacked was knowing *where* they live and how to ship a change
 * without killing themselves mid-task. This tool supplies both: the repo
 * layout, and build / test / restart as first-class actions.
 *
 * The restart is detached and delayed so the reply that announces it reaches
 * the HUD before the process goes down.
 */
import { spawn, execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { ToolDefinition } from '../types/index.js';

/** Walks up from this file until it finds the workspace root's package.json. */
export function findRepoRoot(from = __dirname): string {
  const override = process.env['JARVIS_REPO'];
  if (override && existsSync(join(override, 'package.json'))) return override;
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string; workspaces?: unknown };
        if (j.name === 'jarvis' && j.workspaces) return dir;
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

export const CODEBASE_MAP = `Repo: ${REPO_ROOT}  (npm workspaces: server/, hud/)
  server/src/index.ts        Fastify boot — registers tools, routes, WS, auth
  server/src/core/           jarvis.ts (system prompt + chat loop), agent-pool.ts (sub-agent loop),
                             model-routing.ts + providers/ (Anthropic / Ollama / OpenAI adapters),
                             memory.ts (SQLite ~/.jarvis/jarvis.db), tool-registry.ts, auth.ts
  server/src/tools/          one file per tool the model can call (this file is self.ts)
  server/src/routes/         REST endpoints under /api/*
  server/src/modules/        integrations: wolfram, voice, scheduler, computer-use, browser, bambu
  hud/src/app/page.tsx       Next.js entry (auth gate → setup → HQ)
  hud/src/components/        JarvisChat, Workspace (dock + floating panels), Modules/*, JarvisCards/*
  hud/src/lib/               store.ts (zustand), workspace.ts (module registry), ws-url, auth
  deploy/                    Caddyfile (:80/:443 front door), launchd plists, install scripts
Runtime: launchd agents com.jarvis.server (:7777) and com.jarvis.hud (:3001), Caddy on :80/:443.
Ship a change: edit → self build → self test → self restart. Build output: server/dist, hud/.next-staging (promoted to .next by restart).`;

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: REPO_ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } },
      (err, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();
        resolve({ ok: !err, output: output.length > 12_000 ? `…${output.slice(-12_000)}` : output });
      });
  });
}

function launchdTarget(label: string): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return `gui/${uid}/${label}`;
}

/**
 * Schedules a restart after `delayMs`, detached from this process.
 *
 * For the HUD this first promotes any staged build (.next-staging → .next) and
 * kickstarts in the same breath, then clears the previous build. Building into
 * .next directly would delete chunks under the live server for the whole
 * build; staging keeps the live HUD untouched until this exact moment.
 */
export function scheduleRestart(what: 'server' | 'hud' | 'both', delayMs = 1500): string {
  const labels = what === 'both' ? ['com.jarvis.hud', 'com.jarvis.server'] : [`com.jarvis.${what}`];
  const steps: string[] = [];
  for (const l of labels) {
    if (l === 'com.jarvis.hud') steps.push(`bash '${join(REPO_ROOT, 'deploy', 'promote-hud.sh')}'`);
    steps.push(`launchctl kickstart -k ${launchdTarget(l)}`);
    if (l === 'com.jarvis.hud') steps.push(`rm -rf '${join(REPO_ROOT, 'hud', '.next-prev')}'`);
  }
  const script = `sleep ${Math.max(0.2, delayMs / 1000)}; ${steps.join('; ')}`;
  const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
  return labels.join(' + ');
}

export const selfTool: ToolDefinition = {
  name: 'self',
  description: `Your own source code and deployment. Use this whenever the operator asks you to change, fix, or extend JARVIS itself — "your webapp", "your HUD", "add a panel to yourself", "fix your own bug".

Actions:
- info     → repo path, directory map, git status. Call this FIRST before touching your own code.
- build    → npm run build (server tsc + hud next build, staged). Returns compiler output. ~30-60s. The live HUD is untouched until restart.
- test     → npm test across both workspaces.
- restart  → restart the running services so a built change goes live. Detached, fires ~1.5s later.
             what: "hud" (Next.js only — safe, doesn't interrupt you), "server" or "both" (kills this
             process, including any running agents — only after everything is built and tested).

Workflow for self-modification:
  1. self info · read the relevant files with filesystem/shell
  2. edit with filesystem · 3. self build · 4. self test (fix and repeat until green)
  5. HUD-only change → self restart what=hud, done. Server change → tell the operator it's built and
     ready, then self restart what=server as your very last act — you will go down and come back.
Sub-agents: do steps 1–4 and finish with TASK COMPLETE noting "restart required"; never call restart
yourselves — the main Jarvis does that so your completion is recorded.`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['info', 'build', 'test', 'restart'] },
      what: { type: 'string', enum: ['hud', 'server', 'both'], description: 'restart only. Default hud.' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    switch (action) {
      case 'info': {
        const git = await run('git', ['status', '--short', '--branch'], 10_000);
        const head = await run('git', ['log', '--oneline', '-5'], 10_000);
        return `${CODEBASE_MAP}\n\nGit:\n${git.output}\n\nRecent commits:\n${head.output}`;
      }
      case 'build': {
        // Server output lands in server/dist (safe: the running process has its
        // modules loaded). The HUD build is staged and only goes live on restart.
        const r = await run('npm', ['run', 'build'], 5 * 60_000);
        const staged = existsSync(join(REPO_ROOT, 'hud', '.next-staging', 'BUILD_ID'));
        return `${r.ok ? 'BUILD OK' : 'BUILD FAILED'}${r.ok && staged ? ' — HUD build staged; it goes live on `self restart what=hud`' : ''}\n${r.output}`;
      }
      case 'test': {
        const r = await run('npm', ['test'], 5 * 60_000);
        return `${r.ok ? 'TESTS PASSED' : 'TESTS FAILED'}\n${r.output}`;
      }
      case 'restart': {
        const what = ((input['what'] as string | undefined) ?? 'hud') as 'hud' | 'server' | 'both';
        const which = scheduleRestart(what);
        return what === 'hud'
          ? `Restarting ${which} in ~1.5s. The HUD will reload; this process stays up.`
          : `Restarting ${which} in ~1.5s. This process will go down and come back; the HUD reconnects automatically.`;
      }
      default:
        return `Unknown action "${action}". Use info, build, test, or restart.`;
    }
  },
};
