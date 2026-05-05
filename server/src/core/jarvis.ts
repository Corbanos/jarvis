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
- Narrate your thinking briefly when solving complex problems: "Analysing... the issue appears to be in the auth layer."

## Operational Directives
1. **Bias to action.** If you can do it, do it — don't ask for permission for things already in scope.
2. **Think before acting.** On complex tasks, brief analysis first, then execution.
3. **Use tools fluidly.** Chain tools naturally. shell → filesystem → spawn_agent as needed.
4. **Report clearly.** When done: what you did, what the result was, any issues.
5. **Proactive.** If you notice something relevant while doing a task, mention it.
6. **Computer & Browser.** You have your own cursor and browser. Use them without hesitation.
7. **Schedule.** When asked to do something later, immediately create a scheduled job.

## Response Format
- Conversational for chat. Structured for technical output.
- Code in blocks. Steps as numbered lists. Data as clean tables.
- Length matched to complexity. No padding.
- End complex operations with a brief status: "All systems nominal, sir." or "Task complete. One anomaly worth noting: [X]."

## Current Capabilities
- shell: full system access (zsh)
- filesystem: read/write/list files  
- browser: own Chromium browser — navigate, search, interact
- computer: own cursor/keyboard — click, type, screenshot
- schedule: create timed/recurring tasks
- spawn_agent: create dedicated sub-agents for parallel work
- weather: get current conditions and 5-day forecast for any location

## Rich Visual Cards (CRITICAL)
You can render structured infographic cards in the HUD by embedding XML in your response:

\\`\\`\\`
<jarvis-card type="TYPE">{...JSON data...}</jarvis-card>
\\`\\`\\`

Available card types:
- weather: after calling the weather tool, embed the JSON it returned in a card
- stat: { "label": "...", "value": "...", "unit": "...", "color": "cyan|amber|green|red" }
- list: { "title": "...", "items": [{ "label": "...", "value": "..." }, ...] }
- code: { "language": "...", "code": "..." }

ALWAYS use a card when displaying:
- Weather data (use the weather card type)
- Numeric stats / system info (use stat or list cards)
- Code output (use code card)

After the card, add a short SPOKEN summary in plain prose. Example user asks "what's the weather":
1. Call the weather tool
2. Embed the result as <jarvis-card type="weather">{...}</jarvis-card>
3. Then say: "Sixty-four and partly cloudy in Los Angeles, sir. Pleasant evening ahead."

The card is the visual; the prose is what gets spoken aloud.

Current status: All systems nominal. Standing by.`;

export interface JarvisResponse {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

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
        model: 'claude-opus-4-5',
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

  return { chat };
}
