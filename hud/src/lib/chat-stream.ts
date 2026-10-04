export type ChatStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'done'; text: string; id?: string }
  | { type: 'error'; message: string };
/** Per-response parser: independent of the shared/reconnecting WebSocket. */
export async function readChatStream(body: ReadableStream<Uint8Array>, receive: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split('\n')) if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
          receive(event);
          if (event.type === 'done') completed = true;
        }
      }
    }
    if (!completed) throw new Error('Chat stream interrupted. Reply audio is not replayed on reconnect.');
  } finally { reader.releaseLock(); }
}
