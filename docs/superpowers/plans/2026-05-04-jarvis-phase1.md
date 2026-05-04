# JARVIS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-quality Iron Man–style AI operator scaffold with a Fastify/Anthropic backend and Next.js HUD.

**Architecture:** Fastify server on port 7777 hosts the Anthropic agentic loop, WebSocket broadcast hub, SQLite memory, and tool registry. Next.js HUD on port 3001 connects via WebSocket and REST for real-time visualization of AI thinking, tool calls, and agent spawns.

**Tech Stack:** TypeScript (strict), Fastify 5, @anthropic-ai/sdk, better-sqlite3, Next.js 15, Tailwind CSS v4, Zustand, D3, Framer Motion.

---

## File Map

### Root
- Create: `package.json` — workspace root, concurrently dev script
- Create: `tsconfig.json` — base TS config
- Create: `.env.example` — env var template

### Server
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/types/index.ts` — all shared types (WSEvent, Agent, Job, Message, Tool interfaces)
- Create: `server/src/core/memory.ts` — SQLite DB init, conversation + agent persistence
- Create: `server/src/core/tool-registry.ts` — tool registration and dispatch
- Create: `server/src/tools/shell.ts` — exec shell commands
- Create: `server/src/tools/filesystem.ts` — read/write/list files
- Create: `server/src/tools/web-search.ts` — stub returning placeholder results
- Create: `server/src/tools/spawn-agent.ts` — spawn sub-agent via agent-pool
- Create: `server/src/core/agent-pool.ts` — child process manager
- Create: `server/src/core/jarvis.ts` — Anthropic streaming agentic loop
- Create: `server/src/ws.ts` — WebSocket hub (broadcast to all clients)
- Create: `server/src/routes/chat.ts` — POST /api/chat streaming SSE
- Create: `server/src/routes/agents.ts` — GET/POST/DELETE /api/agents
- Create: `server/src/routes/jobs.ts` — GET/POST/DELETE /api/jobs
- Create: `server/src/routes/telemetry.ts` — POST /api/telemetry/event
- Create: `server/src/index.ts` — Fastify bootstrap

### HUD
- Create: `hud/package.json`
- Create: `hud/tsconfig.json`
- Create: `hud/next.config.ts`
- Create: `hud/tailwind.config.ts`
- Create: `hud/src/app/globals.css` — Iron Man CSS vars + all animations
- Create: `hud/src/app/layout.tsx` — root layout
- Create: `hud/src/app/page.tsx` — dashboard grid
- Create: `hud/src/components/HUDPanel/index.tsx` — corner-bracket panel wrapper
- Create: `hud/src/components/HUDPanel/HUDPanel.module.css`
- Create: `hud/src/components/StatusBar/index.tsx`
- Create: `hud/src/components/JarvisChat/index.tsx`
- Create: `hud/src/components/JarvisChat/ThinkingStream.tsx`
- Create: `hud/src/components/JarvisChat/MessageBubble.tsx`
- Create: `hud/src/components/AgentSwarm/index.tsx` — D3 force graph
- Create: `hud/src/components/AgentSwarm/AgentNode.tsx`
- Create: `hud/src/components/TelemetryFeed/index.tsx`
- Create: `hud/src/components/HexGrid/index.tsx`
- Create: `hud/src/hooks/useJarvisWS.ts` — auto-reconnect WebSocket
- Create: `hud/src/hooks/useJarvisChat.ts` — streaming chat hook
- Create: `hud/src/lib/jarvis-client.ts` — typed API client

---

## Task 1: Root Workspace + Config Files

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `hud/package.json`
- Create: `hud/tsconfig.json`
- Create: `hud/next.config.ts`
- Create: `hud/tailwind.config.ts`

- [ ] Write root `package.json`:
```json
{
  "name": "jarvis",
  "private": true,
  "workspaces": ["server", "hud"],
  "scripts": {
    "dev": "concurrently \"npm run dev --workspace=server\" \"npm run dev --workspace=hud\"",
    "build": "npm run build --workspace=server && npm run build --workspace=hud"
  },
  "devDependencies": {
    "concurrently": "latest"
  }
}
```

- [ ] Write root `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] Write `.env.example`:
```
ANTHROPIC_API_KEY=your_key_here
JARVIS_PORT=7777
HUD_PORT=3001
NODE_ENV=development
```

- [ ] Write `server/package.json` with all server deps and `"dev": "tsx watch src/index.ts"`.

- [ ] Write `server/tsconfig.json` extending root with NodeNext module.

- [ ] Write `hud/package.json` with Next 15, Tailwind 4, Zustand, D3, Framer Motion, Lucide.

- [ ] Write `hud/tsconfig.json` for Next.js.

- [ ] Write `hud/next.config.ts`.

- [ ] Write `hud/tailwind.config.ts`.

- [ ] Install deps: `npm install` from root.

- [ ] Commit: `git add . && git commit -m "chore: workspace scaffold + package configs"`

---

## Task 2: Server Types + SQLite Memory

**Files:**
- Create: `server/src/types/index.ts`
- Create: `server/src/core/memory.ts`

- [ ] Write `server/src/types/index.ts` with all interfaces: `WSEvent`, `WSEventType`, `AgentRecord`, `JobRecord`, `Message`, `ToolDefinition`, `ToolResult`, `ChatRequest`, `ChatStreamChunk`.

- [ ] Write `server/src/core/memory.ts` — initialize SQLite with tables: `conversations`, `messages`, `agents`, `jobs`. Export `db` singleton and CRUD helpers.

- [ ] Commit: `git commit -m "feat: shared types + SQLite memory layer"`

---

## Task 3: Tool Registry + Individual Tools

**Files:**
- Create: `server/src/core/tool-registry.ts`
- Create: `server/src/tools/shell.ts`
- Create: `server/src/tools/filesystem.ts`
- Create: `server/src/tools/web-search.ts`
- Create: `server/src/tools/spawn-agent.ts`

- [ ] Write `server/src/core/tool-registry.ts` — `ToolRegistry` class with `register()`, `dispatch()`, `getAnthropicTools()`.

- [ ] Write `server/src/tools/shell.ts` — `execAsync` wrapper, returns `{ stdout, stderr, exitCode }`, timeout 30s.

- [ ] Write `server/src/tools/filesystem.ts` — `readFile`, `writeFile`, `listDir`, all with path validation.

- [ ] Write `server/src/tools/web-search.ts` — stub returning `[{ title, url, snippet }]` array with a note it's unimplemented.

- [ ] Write `server/src/tools/spawn-agent.ts` — calls `agentPool.spawn()`, returns `{ agentId, status }`.

- [ ] Commit: `git commit -m "feat: tool registry + shell/fs/search/spawn tools"`

---

## Task 4: Agent Pool (Child Process Manager)

**Files:**
- Create: `server/src/core/agent-pool.ts`

- [ ] Write `server/src/core/agent-pool.ts`:
  - `AgentPool` class with `spawn(goal, tools, sessionId)` → forks a child process running an inline agent loop script
  - Agent loop: reads goal from env, runs simplified Anthropic loop (no streaming), posts results back via IPC messages
  - Tracks agents in `Map<agentId, AgentProcess>`
  - `kill(agentId)`, `list()`, `get(agentId)` methods
  - Broadcasts `agent_spawn`, `agent_complete`, `agent_failed` WS events

- [ ] Commit: `git commit -m "feat: agent pool with child process lifecycle management"`

---

## Task 5: WebSocket Hub

**Files:**
- Create: `server/src/ws.ts`

- [ ] Write `server/src/ws.ts`:
  - `WSHub` class tracking all connected `WebSocket` instances
  - `broadcast(event: WSEvent)` — serializes and sends to all
  - `addClient(ws)` / `removeClient(ws)`
  - Export singleton `wsHub`

- [ ] Commit: `git commit -m "feat: WebSocket broadcast hub"`

---

## Task 6: Jarvis AI Core Loop

**Files:**
- Create: `server/src/core/jarvis.ts`

- [ ] Write `server/src/core/jarvis.ts`:
  - `JarvisCore` class
  - `chat(sessionId, userMessage, onToken)` async method
  - Uses `anthropic.messages.stream()` with claude-sonnet-4-5
  - System prompt: full Iron Man Jarvis persona (British, precise, "sir", analyzes before acting)
  - Agentic loop: collect tool_use blocks → dispatch via tool-registry → append tool_result → continue loop
  - Broadcasts: `thinking` (text delta tokens), `tool_call` (before exec), `tool_result` (after exec), `message` (final)
  - Persists messages to SQLite
  - Max 10 agentic turns per request

- [ ] Commit: `git commit -m "feat: Jarvis AI core with Anthropic streaming agentic loop"`

---

## Task 7: Fastify Routes

**Files:**
- Create: `server/src/routes/chat.ts`
- Create: `server/src/routes/agents.ts`
- Create: `server/src/routes/jobs.ts`
- Create: `server/src/routes/telemetry.ts`

- [ ] Write `server/src/routes/chat.ts` — POST /api/chat with SSE streaming response; calls `jarvisCore.chat()`, streams tokens back.

- [ ] Write `server/src/routes/agents.ts` — GET (list agents), DELETE /:id (kill agent).

- [ ] Write `server/src/routes/jobs.ts` — GET (list jobs from SQLite), POST (create job record), DELETE /:id.

- [ ] Write `server/src/routes/telemetry.ts` — POST /api/telemetry/event: stores event + broadcasts to WS clients.

- [ ] Commit: `git commit -m "feat: REST API routes (chat, agents, jobs, telemetry)"`

---

## Task 8: Fastify Server Bootstrap

**Files:**
- Create: `server/src/index.ts`

- [ ] Write `server/src/index.ts`:
  - Create Fastify instance with logger
  - Register `@fastify/cors`, `@fastify/websocket`
  - WS route at `/ws`: on connection add to wsHub, on close remove
  - Register all route plugins under `/api/*`
  - On startup: init SQLite, register all tools, log ready message
  - Listen on `JARVIS_PORT` (default 7777)

- [ ] Run `npm run dev --workspace=server` and verify server starts, `/ws` accepts connections.

- [ ] Commit: `git commit -m "feat: Fastify server bootstrap with WS + all routes registered"`

---

## Task 9: HUD Global Styles + Layout

**Files:**
- Create: `hud/src/app/globals.css`
- Create: `hud/src/app/layout.tsx`

- [ ] Write `hud/src/app/globals.css` with all CSS variables, all 5 keyframe animations (scanline, pulse-glow, hex-rotate, text-flicker, data-stream), body styles.

- [ ] Write `hud/src/app/layout.tsx` — root layout with dark bg, metadata "J.A.R.V.I.S.", imports globals.css.

- [ ] Commit: `git commit -m "feat: HUD global CSS + Iron Man design tokens"`

---

## Task 10: HUDPanel Component

**Files:**
- Create: `hud/src/components/HUDPanel/index.tsx`
- Create: `hud/src/components/HUDPanel/HUDPanel.module.css`

- [ ] Write `HUDPanel/HUDPanel.module.css` — corner brackets via ::before/::after, pulse-glow border animation, scanline overlay, glass background.

- [ ] Write `HUDPanel/index.tsx` — accepts `title`, `status`, `active`, `children` props; renders corner brackets, title bar with status dot, content area.

- [ ] Commit: `git commit -m "feat: HUDPanel component with Iron Man corner-bracket aesthetic"`

---

## Task 11: StatusBar Component

**Files:**
- Create: `hud/src/components/StatusBar/index.tsx`

- [ ] Write `StatusBar/index.tsx` — reads from Zustand store; shows "J.A.R.V.I.S. ONLINE", uptime counter (useEffect interval), active agent count, memory usage. Uses text-flicker animation on title. Full-width monospace bar.

- [ ] Commit: `git commit -m "feat: StatusBar component"`

---

## Task 12: WebSocket Hook + Zustand Store

**Files:**
- Create: `hud/src/hooks/useJarvisWS.ts`

- [ ] Write `hud/src/hooks/useJarvisWS.ts`:
  - Connect to `ws://localhost:7777/ws`
  - Auto-reconnect with exponential backoff (max 30s)
  - On message: parse JSON, dispatch to Zustand store actions based on `event.type`
  - Store state: `{ connected, agents, telemetryEvents, thinkingTokens, activeToolCall }`
  - Export `useJarvisStore` Zustand store alongside the hook

- [ ] Commit: `git commit -m "feat: WS hook with auto-reconnect + Zustand store"`

---

## Task 13: Jarvis API Client + Chat Hook

**Files:**
- Create: `hud/src/lib/jarvis-client.ts`
- Create: `hud/src/hooks/useJarvisChat.ts`

- [ ] Write `hud/src/lib/jarvis-client.ts` — typed fetch wrappers for all REST endpoints.

- [ ] Write `hud/src/hooks/useJarvisChat.ts` — manages messages array, calls POST /api/chat with `ReadableStream` SSE parsing, appends tokens to current assistant message in real time.

- [ ] Commit: `git commit -m "feat: API client + streaming chat hook"`

---

## Task 14: JarvisChat Component

**Files:**
- Create: `hud/src/components/JarvisChat/index.tsx`
- Create: `hud/src/components/JarvisChat/MessageBubble.tsx`
- Create: `hud/src/components/JarvisChat/ThinkingStream.tsx`

- [ ] Write `MessageBubble.tsx` — renders user/assistant messages; assistant messages render with monospace code blocks styled in cyan.

- [ ] Write `ThinkingStream.tsx` — subscribes to `thinkingTokens` from Zustand; renders live scrolling token stream + active tool call card with amber glow.

- [ ] Write `JarvisChat/index.tsx` — textarea input (Enter=send, Shift+Enter=newline), message list (auto-scroll), ThinkingStream below messages, all inside HUDPanel.

- [ ] Commit: `git commit -m "feat: JarvisChat with streaming input + thinking visualization"`

---

## Task 15: AgentSwarm D3 Visualization

**Files:**
- Create: `hud/src/components/AgentSwarm/index.tsx`
- Create: `hud/src/components/AgentSwarm/AgentNode.tsx`

- [ ] Write `AgentNode.tsx` — renders a single agent circle with status color (spawning=amber, running=cyan, complete=green, failed=red), label below, framer-motion fade-in/out.

- [ ] Write `AgentSwarm/index.tsx`:
  - D3 force simulation with agents from Zustand store
  - SVG canvas sized to panel
  - Central "JARVIS" hub node, agent nodes arranged by force
  - Lines connecting agents to hub
  - useEffect to restart simulation when agents change
  - Framer Motion AnimatePresence for node enter/exit

- [ ] Commit: `git commit -m "feat: AgentSwarm D3 force graph visualization"`

---

## Task 16: TelemetryFeed + HexGrid

**Files:**
- Create: `hud/src/components/TelemetryFeed/index.tsx`
- Create: `hud/src/components/HexGrid/index.tsx`

- [ ] Write `TelemetryFeed/index.tsx` — reads `telemetryEvents` from Zustand; scrolling feed of timestamped events, color-coded by type, auto-scroll to bottom, max 100 events.

- [ ] Write `HexGrid/index.tsx` — SVG hex pattern across full viewport, animated slow rotation/drift, low opacity (0.07), rendered as `position: fixed` background behind everything.

- [ ] Commit: `git commit -m "feat: TelemetryFeed + animated HexGrid background"`

---

## Task 17: Main Dashboard Page

**Files:**
- Create: `hud/src/app/page.tsx`

- [ ] Write `hud/src/app/page.tsx`:
  - Initialize `useJarvisWS()` at top level
  - Layout: CSS grid
    - Row 1: `StatusBar` full width
    - Row 2: Left 2/3 `JarvisChat`, Right 1/3 top `AgentSwarm`, Right 1/3 bottom `TelemetryFeed`
    - Row 3 (strip): `ThinkingStream` standalone instance showing global WS thinking tokens
  - `HexGrid` as fixed background
  - All panels wrapped in `HUDPanel` with appropriate titles

- [ ] Run `npm run dev --workspace=hud` and verify page renders.

- [ ] Commit: `git commit -m "feat: main dashboard layout with all HUD panels"`

---

## Task 18: Integration + Final Polish

- [ ] Run both server and HUD concurrently: `npm run dev` from root.

- [ ] Verify: server starts on 7777, HUD on 3001, WS connects (StatusBar shows connected).

- [ ] Send a test message, verify streaming tokens appear in ThinkingStream.

- [ ] Run: `openclaw system event --text "Done: JARVIS Phase 1 scaffold complete — server + HUD + AI loop ready" --mode now`

- [ ] Final commit: `git commit -m "feat: JARVIS Phase 1 complete — server + HUD + AI loop"`
