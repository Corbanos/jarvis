'use client';
import { useState, useCallback, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { v4 as uuid } from 'uuid';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';
const DEDUP_MS = 2000; // ignore identical messages within this window

export function useJarvisChat() {
  const [loading, setLoading] = useState(false);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const clearThinking = useJarvisStore((s) => s.clearThinking);
  const lastSentRef = useRef<{ text: string; ts: number } | null>(null);

  const send = useCallback(async (text: string, sessionId = 'default') => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // Dedup: ignore same message sent within DEDUP_MS
    const now = Date.now();
    if (
      lastSentRef.current &&
      lastSentRef.current.text === trimmed &&
      now - lastSentRef.current.ts < DEDUP_MS
    ) {
      console.warn('[Chat] Duplicate message suppressed:', trimmed);
      return;
    }
    lastSentRef.current = { text: trimmed, ts: now };

    addMessage({ id: uuid(), role: 'user', text: trimmed, timestamp: now });
    clearThinking();
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId }),
      });

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        void decoder.decode(value); // SSE handled via WebSocket
      }
    } catch (err) {
      addMessage({ id: uuid(), role: 'assistant', text: `System error: ${err}`, timestamp: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [loading, addMessage, clearThinking]);

  return { send, loading };
}
