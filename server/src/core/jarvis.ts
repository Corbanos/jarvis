import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { toolRegistry } from './tool-registry.js';
import { memory } from './memory.js';
import { speak, getVoiceInfo } from '../modules/voice-tts.js';
import { log } from './logger.js';
import type { WSHub } from '../ws.js';

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

### When to spawn_agent
Delegate anything requiring substantial tool use, file writes, multi-step browsing, or shell work. You are the conductor; agents play the music.

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



export interface JarvisResponse {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

// Current model used by Jarvis (shared with agent-pool)
let currentModel = 'claude-sonnet-4-20250514';

export function createJarvis(ws: WSHub) {
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

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
      // Stream the response so HUD sees tokens live
      let iterText = '';
      const stream = client.messages.stream({
        model: currentModel,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: toolRegistry.anthropicTools() as Anthropic.Tool[],
        messages,
      });

      // Stream text tokens to HUD/caller as they arrive
      stream.on('text', (token: string) => {
        iterText += token;
        onToken?.(token);
        broadcast('thinking', { sessionId, token, id: msgId });
      });

      // Wait for the message to fully complete
      const final = await stream.finalMessage();

      // Append this iteration's text to overall response
      finalText += iterText;

      // If the model decided it's done talking, exit the loop
      if (final.stop_reason !== 'tool_use') {
        break;
      }

      // Otherwise, execute every tool_use block, then send results back
      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
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
    return currentModel;
  }

  return { chat, setModel, getModel };
}
