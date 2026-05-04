'use client';
import { useState, useCallback } from 'react';
import { useJarvisStore } from '@/lib/store';
import { v4 as uuid } from 'uuid';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function useJarvisChat() {
  const [loading, setLoading] = useState(false);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const clearThinking = useJarvisStore((s) => s.clearThinking);

  const send = useCallback(async (text: string, sessionId = 'default') => {
    if (!text.trim() || loading) return;

    const userMsgId = uuid();
    addMessage({ id: userMsgId, role: 'user', text, timestamp: Date.now() });
    clearThinking();
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // SSE events already handled via WS — here we just drain the stream
        void chunk;
      }
    } catch (err) {
      addMessage({ id: uuid(), role: 'assistant', text: `System error: ${err}`, timestamp: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [loading, addMessage, clearThinking]);

  return { send, loading };
}
