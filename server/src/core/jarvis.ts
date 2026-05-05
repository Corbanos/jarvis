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

Current status: All systems nominal. Standing by.`;

export interface JarvisResponse {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

export function createJarvis(ws: WSHub) {
  const client = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });

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

    const history = memory.getMessages(sessionId, 30).reverse();
    const anthropicMessages: Anthropic.MessageParam[] = history
      .slice(0, -1)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    anthropicMessages.push({ role: 'user', content: userMessage });

    let fullText = '';
    const toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }> = [];
    let currentMessages = anthropicMessages;
    let loopCount = 0;
    let continueLoop = true;

    broadcast('thinking', { sessionId, token: '', id: msgId, start: true });

    while (continueLoop) {
      loopCount++;
      if (loopCount > 10) {
        log.warn('AI', 'Agentic loop limit (10) reached — stopping');
        break;
      }

      const stream = client.messages.stream({
        model: 'claude-opus-4-5',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: toolRegistry.anthropicTools() as Anthropic.Tool[],
        messages: currentMessages,
      });

      let currentToolUseId = '';
      let currentToolName = '';
      let currentToolInputJson = '';
      const pendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolUseId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInputJson = '';
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const token = event.delta.text;
            fullText += token;
            onToken?.(token);
            broadcast('thinking', { sessionId, token, id: msgId });
          } else if (event.delta.type === 'input_json_delta') {
            currentToolInputJson += event.delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop' && currentToolName) {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(currentToolInputJson || '{}'); } catch { /* ignore */ }
          pendingToolUses.push({ id: currentToolUseId, name: currentToolName, input: parsedInput });
          log.tool_call(currentToolName, sessionId);
          broadcast('tool_call', { sessionId, name: currentToolName, input: parsedInput, status: 'executing', id: msgId });
          currentToolName = '';
          currentToolUseId = '';
          currentToolInputJson = '';
        }

        if (event.type === 'message_stop') {
          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason === 'tool_use' && pendingToolUses.length > 0) {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const tu of pendingToolUses) {
              const result = await toolRegistry.dispatch(tu.name, tu.input);
              log.tool_result(tu.name, result);
              toolCalls.push({ name: tu.name, input: tu.input, result });
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
              broadcast('tool_result', { sessionId, name: tu.name, result: result.substring(0, 800), id: msgId });
            }

            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: finalMsg.content },
              { role: 'user', content: toolResults },
            ];
          } else {
            continueLoop = false;
          }
        }
      }
    }

    if (fullText) {
      memory.saveMessage(uuid(), sessionId, 'assistant', fullText);
      log.ai('Jarvis →', `"${fullText.slice(0, 100)}"${fullText.length > 100 ? '…' : ''}`);
    }

    broadcast('message', { sessionId, id: msgId, role: 'assistant', text: fullText });

    // Speak non-agent responses under 600 chars
    if (opts.speak !== false && !opts.isAgent && fullText && fullText.length < 600) {
      const voiceInfo = await getVoiceInfo();
      log.tts(fullText, voiceInfo.kokoroAvailable ? 'Kokoro' : `macOS ${voiceInfo.voice}`);
      speak(fullText).catch(() => { /* silent */ });
    }

    return { text: fullText, toolCalls };
  }

  return { chat };
}
