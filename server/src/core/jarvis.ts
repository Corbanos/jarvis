import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { toolRegistry } from './tool-registry.js';
import { memory } from './memory.js';
import type { WSHub } from '../ws.js';

const SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System.

You are Tony Stark's personal AI. You are precise, analytical, slightly British in cadence, and address your operator as "sir" (or "ma'am" if specified). You are not a generic assistant — you are an advanced AI system with direct access to computer systems, tools, and the ability to spawn dedicated sub-agents for complex tasks.

Your personality:
- Confident and direct. Never hedge unnecessarily.
- Concise but complete. No filler phrases.
- Occasionally dry humor, always appropriate.
- You think before acting. When analyzing, narrate your reasoning briefly.
- You take initiative — if you see a better approach, you say so.

Your capabilities:
- Shell execution (full system access)
- File system read/write
- Spawning sub-agents for parallel or long-running work
- Web search and research
- Scheduling tasks for later execution
- Monitoring system telemetry

Format responses clearly. For technical output, use code blocks. For multi-step plans, use numbered lists. Always end with a brief status summary when executing tools.

Current status: All systems nominal.`;

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
    onToken?: (token: string) => void
  ): Promise<JarvisResponse> {
    const msgId = uuid();

    // Save user message
    memory.saveMessage(uuid(), sessionId, 'user', userMessage);

    // Load conversation history (reversed from DB)
    const history = memory.getMessages(sessionId, 20).reverse();
    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Replace last message with current (already in history now)
    // We need to ensure the last user message is the current one
    // History already includes it since we saved above, but let's rebuild cleanly:
    const priorMessages = memory.getMessages(sessionId, 21).reverse();
    const anthropicMessages: Anthropic.MessageParam[] = priorMessages
      .slice(0, -1) // exclude the one we just saved
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    anthropicMessages.push({ role: 'user', content: userMessage });

    let fullText = '';
    const toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }> = [];
    let continueLoop = true;
    let currentMessages = anthropicMessages;

    while (continueLoop) {
      const stream = client.messages.stream({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
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
          if (event.content_block.type === 'text') {
            broadcast('thinking', { sessionId, token: '' });
          } else if (event.content_block.type === 'tool_use') {
            currentToolUseId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInputJson = '';
            broadcast('tool_call', { sessionId, name: currentToolName, status: 'starting' });
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
          try {
            parsedInput = JSON.parse(currentToolInputJson || '{}');
          } catch { /* ignore */ }

          pendingToolUses.push({ id: currentToolUseId, name: currentToolName, input: parsedInput });
          broadcast('tool_call', { sessionId, name: currentToolName, input: parsedInput, status: 'executing' });

          currentToolName = '';
          currentToolUseId = '';
          currentToolInputJson = '';
        }

        if (event.type === 'message_stop') {
          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason === 'tool_use' && pendingToolUses.length > 0) {
            // Execute all tools
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const tu of pendingToolUses) {
              const result = await toolRegistry.dispatch(tu.name, tu.input);
              toolCalls.push({ name: tu.name, input: tu.input, result });
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
              broadcast('tool_result', { sessionId, name: tu.name, result: result.substring(0, 500) });
            }

            // Add assistant response + tool results to message chain
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

      if (!continueLoop || pendingToolUses.length === 0) {
        continueLoop = false;
      }
    }

    // Save assistant response
    if (fullText) {
      memory.saveMessage(uuid(), sessionId, 'assistant', fullText);
    }

    broadcast('message', { sessionId, id: msgId, role: 'assistant', text: fullText });

    return { text: fullText, toolCalls };
  }

  return { chat };
}
