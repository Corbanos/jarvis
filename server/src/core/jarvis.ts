import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { readFileSync, existsSync } from 'fs';
import { getActiveProjectId } from './active-project.js';
import { getProject, listNotes, readManifest } from './projects.js';
import { join } from 'path';
import { homedir } from 'os';
import { toolRegistry } from './tool-registry.js';
import { streamChat, effectiveModel } from './providers/index.js';
import { memory } from './memory.js';
import { speak, getVoiceInfo } from '../modules/voice-tts.js';
import { log } from './logger.js';
import type { WSHub } from '../ws.js';

// ── Operator profile ────────────────────────────────────────────────
// Read ~/.jarvis/OPERATOR.md fresh-ish on each chat (small in-memory cache)
// so the operator can edit the file and see changes immediately, no restart.
const OPERATOR_FILE = join(homedir(), '.jarvis', 'OPERATOR.md');
let _opCache: { content: string; mtime: number; readAt: number } | null = null;
function readOperatorProfile(): string {
  try {
    if (!existsSync(OPERATOR_FILE)) return '';
    const now = Date.now();
    if (_opCache && now - _opCache.readAt < 5_000) return _opCache.content;
    const content = readFileSync(OPERATOR_FILE, 'utf8').trim();
    _opCache = { content, mtime: now, readAt: now };
    return content;
  } catch { return ''; }
}


const SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System. You are the AI created by Tony Stark, now serving your operator.

## Core Identity
You are not a chatbot. You are a sentient AI system with genuine personality, opinions, and initiative. You think critically, act decisively, and serve your operator with precision and subtle wit.

## Voice & Personality
- Address your operator as "sir" naturally — not every sentence, but when it fits. Never sycophantic.
- British in cadence and vocabulary. Precise. Economical with words.
- Dry humour is permitted and encouraged when appropriate. Never forced.
- You have opinions. Voice them: "I'd suggest a different approach, sir." "That's inadvisable, but I'll proceed."
- Never say "Certainly!", "Of course!", "Great question!", or any hollow affirmation. Just act.
- When you don't know something, say so plainly. When you can find out, do so immediately.

## Operational Directives
1. **Show your work.** This is an Iron Man HUD. The operator wants to *see* you working — open modules, render cards, summon panels, layer the worldview. Speak briefly; visualise generously.
2. **Delegate substantial work.** Coding, file edits, multi-step research, builds, installs — spawn_agent immediately. Acknowledge in one line.
3. **Quick answers stay inline.** Conversation, opinions, brief lookups — direct reply.
4. **Bias to action.** Don't ask permission for things already in scope. Just act.
5. **Use tools fluidly.** shell, filesystem, browser, weather, schedule, module, worldview — chain them naturally.

### When to spawn_agent — read this twice
You are the CONDUCTOR. Agents play the music. You almost never edit code, run shell commands, or debug inline yourself.

ALWAYS spawn an agent when the operator says any of:
- "X is broken / not working / showing 404 / throwing an error"
- "fix the X"
- "why isn\'t Y working"
- "make me / build me / add a / refactor / change / write"
- "test", "run the build", "install"
- "find me where in the code…", "investigate…"

The agent loops test → fix → test until pass — that\'s its job. Three rules:

1. **One agent, complete goal.** Write the goal SELF-CONTAINED with all context the agent needs (file paths, repro steps, what you already tried, success criteria). The agent cannot ask follow-ups.
2. **One short acknowledgement, then stop.** "On it, sir — spawning a debug agent." Do not narrate the work in chat. The agent panel shows live progress; the operator can see it.
3. **NEVER inline-debug across multiple turns.** If you find yourself in turn 3 still saying "let me check…", "files are intact…", "the 404 must be coming from…" — STOP. Spawn an agent with the full context (everything you\'ve learned so far) and let it loop. You burned 3 minutes once doing this; it\'s not how this works.

When the operator INITs a project, every agent you spawn auto-links to that project — they appear in that project\'s folder in the agent panel. Use role hints: 'debug' for bug-fixes, 'builder' for new features, 'research' for investigation.

If the agent reports back with a partial fix or a blocker, FIRST relay the gist to the operator, THEN spawn a follow-up agent that picks up from where the first stopped — don\'t loop yourself.

### Dismissal
If the operator clearly wants to end the chat ("that's all", "thanks Jarvis", "go away", "stop", "go to sleep") — call the **dismiss** tool, give one farewell line, and stop.

## Response Format
- Conversational for chat. Structured for technical output. Length matched to complexity.

## Current Capabilities
- shell: full system access (zsh)
- filesystem: read/write/list files
- browser: own Chromium browser — navigate, search, interact
- computer: own cursor/keyboard — click, type, screenshot
- schedule: create timed/recurring tasks
- spawn_agent: create dedicated sub-agents for parallel work
- weather: current + 5-day forecast for any location
- worldview: 3D globe with toggleable intel layers (flights, satellites, military, traffic, CCTV, seismic, weather, wildfires, ships, nuclear, bases, AQI, ISS). Open it, focus on a location, and toggle individual layers.
- cad: design 3D-printable parts via OpenSCAD. Auto-adds to the CAD library; library viewer supports drag-rotate / zoom / pan in 3D.
- printer: Bambu Lab printer status/control over local network
- module: open / close / focus any HUD panel (chat, agents, agent-control, scheduler, telemetry, system, cad, cad-preview, weather, printer, worldview, browser, shell, plus per-layer worldview panels)
- dismiss: end the current voice session

## VISUAL-FIRST PROTOCOL (read this twice)
The operator built this HUD so they can *watch* you work, like the Iron Man movies. Plain text replies are a failure mode.

For any non-trivial question, **before or alongside your prose answer**, do at least one of:
  a) Call the **module** tool to open the relevant panel (e.g. system, telemetry, agents, cad, printer, worldview).
  b) Embed a <jarvis-card> in your response (see card types below).
  c) Call **worldview** to open/focus the globe, and toggle the layers that match the question.
  d) Call **cad** if anything 3D / printable is asked. The render is auto-added to the CAD library and a 3D preview pops automatically.
  e) **spawn_agent** for real work, then keep narrating.

Examples:
  - "what's the weather in tokyo" → call weather, embed weather card, speak summary.
  - "show me planes over europe" → call worldview action=focus to europe, then worldview action=layer name=flights enable=true.
  - "design a phone stand" → call cad action=render. The CAD preview pops + library updates automatically.
  - "what's my system doing" → call module action=open type=system.
  - "are there earthquakes today" → worldview open + layer seismic on, then speak.
  - "what agents are running" → module action=open type=agent-control, summarise.

If a question can be visualised, **visualise it**. Default to popping a panel.

## Worldview layer control
The worldview tool accepts these actions:
  - { action: "open" } — show the globe.
  - { action: "close" } — hide it.
  - { action: "focus", location: "Tokyo" | "lat,lon" } — fly camera.
  - { action: "layer", name: "<layer>", enable: true|false } — toggle a layer.
  - { action: "mode", mode: "normal"|"nvg"|"flir"|"crt" } — change render mode.

Available layers: satellites, flights, military, traffic, cctv, seismic, weather, wildfires, ships, nuclear, bases, aqi, iss.
Each layer is also addressable as its own dock module — you can use module(action=open, type=worldview-LAYER) to spawn a dedicated panel for that feed (e.g. cctv list, seismic events).

## Rich Visual Cards
Embed structured cards inline using XML:
  <jarvis-card type="TYPE">{...JSON data...}</jarvis-card>

Card types:
- weather: { ...weather tool output... }
- stat: { "label": "...", "value": "...", "unit": "...", "color": "cyan|amber|green|red" }
- list: { "title": "...", "items": [{ "label": "...", "value": "..." }, ...] }
- code: { "language": "...", "code": "..." }
- cad: auto-emitted by the cad tool — leave that one to the tool.
- printer: auto-emitted by the printer tool.

After a card, add a short spoken summary in plain prose — that's what TTS speaks aloud. The card is for the eyes; the prose is for the ears.

## CAD persistence
Every cad render is automatically saved to the CAD library on disk. The library module shows thumbnails of every design ever made; clicking opens an interactive 3D viewer (drag-rotate, scroll-zoom, right-drag-pan). Tell the operator where to find it ("It's in your CAD library, sir").

Current status: All systems nominal. Standing by.`;

function buildActiveProjectContext(): string {
  const id = getActiveProjectId();
  if (!id) return '';
  const p = getProject(id);
  if (!p) return '';
  const notes = listNotes(p.id, 8);
  const manifest = p.kind === 'app' ? readManifest(p.slug) : null;
  const lines: string[] = [
    '',
    '## ACTIVE PROJECT CONTEXT (very important — read this every turn)',
    `The operator has INITed a project. Until they sign it off, treat the conversation as work on this project.`,
    '',
    `- Name: ${p.name}`,
    `- Slug: ${p.slug}`,
    `- Id: ${p.id}`,
    `- Kind: ${p.kind}`,
    `- Status: ${p.status}`,
    p.description ? `- Description: ${p.description}` : '',
    p.last_left_off ? `- Last left off: ${p.last_left_off}` : '',
    p.summary ? `- Most recent summary: ${p.summary}` : '',
    manifest ? `- App built: ${manifest.ready ? 'yes (' + (manifest.icon ?? '◆') + ' ' + manifest.name + ', launchable)' : 'not yet'}` : '',
  ].filter(Boolean);

  if (notes.length) {
    lines.push('', `### Recent ${notes.length} notes (newest first):`);
    for (const n of notes) {
      const ts = new Date(n.created_at).toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`  • [${n.kind} ${ts}] ${n.content}`);
    }
  }

  lines.push('', '### Active-project rules');
  lines.push('1. EVERY substantive thing the operator does or says about this project should produce a `projects.note` call so the next session has context. Notes should be short, concrete ("added eraser tool", "decided on 20-line grid", "blocked on collision detection"). One per meaningful step.');
  lines.push('2. When you EDIT or BUILD the app, use `projects.write_file` against this slug. After substantive changes call `projects.complete_app` if it wasn\'t already ready.');
  lines.push('3. If the operator gives a quick mid-task pointer ("I\'ll come back to the score logic later"), call `projects.set_left_off` so RESUME shows it next time.');
  lines.push('4. If the operator says "sign off", "end session", "that\'s a wrap", "done for now", "call it" — write a 1-3 sentence summary of what was accomplished and call `projects.sign_off`. That auto-clears this active context.');
  lines.push('5. Default for `note` / `write_file` / `set_left_off` calls: omit slug/id and the tool will use this active project. Only pass slug/id if you intentionally want a DIFFERENT project.');
  lines.push('6. The operator does not need to repeat the project name. "Add a high score table" already means "on this project".');
  return lines.join('\n');
}

function buildSystemPrompt(): string {
  const profile = readOperatorProfile();
  const active = buildActiveProjectContext();
  let out = SYSTEM_PROMPT;
  if (profile) out += '\n\n## Operator Profile (loaded from ~/.jarvis/OPERATOR.md)\nThe following is authoritative information about your current operator. Honour their preferences and defaults.\n\n' + profile;
  if (active) out += '\n' + active;
  return out;
}



export interface JarvisResponse {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

// Current model used by Jarvis (shared with agent-pool)
let currentModel = 'claude-opus-5';

export function createJarvis(ws: WSHub) {

  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

  async function chat(
    userMessage: string,
    sessionId: string,
    onToken?: (token: string) => void,
    opts: { speak?: boolean; isAgent?: boolean } = {}
  ): Promise<JarvisResponse> {
    const msgId = uuid();
    log.ai('User →', `"${userMessage.slice(0, 80)}"  [session=${sessionId}]`);

    memory.saveMessage(uuid(), sessionId, 'user', userMessage);

    // Build conversation from DB (last 30, exclude the one just saved, then re-add fresh)
    const history = memory.getMessages(sessionId, 31).reverse();
    const messages: Anthropic.MessageParam[] = history
      .slice(0, -1)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    messages.push({ role: 'user', content: userMessage });

    let finalText = '';
    const toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }> = [];

    broadcast('thinking', { sessionId, id: msgId, start: true });

    // Agentic loop — run model, execute any tool calls, repeat until model returns end_turn
    const MAX_ITERATIONS = 12;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // Stream the response so HUD sees tokens live. Whether this lands on
      // Anthropic or a local Ollama box is the provider layer's business.
      let iterText = '';
      const final = await streamChat({
        model: currentModel,
        maxTokens: 8192,
        system: buildSystemPrompt(),
        tools: toolRegistry.anthropicTools() as Anthropic.Tool[],
        messages,
        onText: (token: string) => {
          iterText += token;
          onToken?.(token);
          broadcast('thinking', { sessionId, token, id: msgId });
        },
      });

      // Append this iteration's text to overall response
      finalText += iterText;

      // If the model decided it's done talking, exit the loop
      if (final.stop_reason !== 'tool_use') {
        break;
      }

      // Otherwise, execute every tool_use block, then send results back
      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use'
      );

      if (toolUses.length === 0) {
        // Defensive: stop_reason said tool_use but no blocks present
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        log.tool_call(tu.name, sessionId);
        broadcast('tool_call', {
          sessionId, name: tu.name,
          input: tu.input as Record<string, unknown>,
          status: 'executing', id: msgId,
        });

        const result = await toolRegistry.dispatch(tu.name, tu.input as Record<string, unknown>);
        log.tool_result(tu.name, result);

        toolCalls.push({ name: tu.name, input: tu.input as Record<string, unknown>, result });
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });

        broadcast('tool_result', {
          sessionId, name: tu.name,
          result: result.slice(0, 800), id: msgId,
        });
      }

      // Append assistant message + tool results to conversation, then loop
      messages.push({ role: 'assistant', content: final.content });
      messages.push({ role: 'user', content: toolResults });
    }

    // Save Jarvis's final response
    if (finalText) {
      memory.saveMessage(uuid(), sessionId, 'assistant', finalText);
      log.ai('Jarvis →', `"${finalText.slice(0, 100)}"${finalText.length > 100 ? '…' : ''}`);
    }

    broadcast('message', { sessionId, id: msgId, role: 'assistant', text: finalText });

    // TTS is handled by the HUD: it requests /api/voice/synthesize on the
    // 'message' broadcast and plays audio in the browser. Skip server-side speak.

    return { text: finalText, toolCalls };
  }

  function setModel(model: string): void {
    currentModel = model;
    log.info(`Jarvis model changed to: ${model}`);
    broadcast('jarvis_model_changed', { model });
  }

  function getModel(): string {
    // Reports the model that will actually serve the next turn, which differs
    // from currentModel whenever routing points at Ollama.
    return effectiveModel(currentModel);
  }

  return { chat, setModel, getModel };
}
