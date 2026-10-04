'use client';
import { useState, useCallback, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { v4 as uuid } from 'uuid';
import { readChatStream } from '@/lib/chat-stream';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

// Module-level in-flight guard — never stale, survives re-renders
let _sending = false;
let _lastSentText = '';
let _lastSentAt = 0;
const DEDUP_MS = 3000;

export function useJarvisChat() {
  const [loading, setLoading] = useState(false);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const clearThinking = useJarvisStore((s) => s.clearThinking);

  const send = useCallback(async (text: string, sessionId = 'default') => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Module-level guard — not subject to React closure staleness
    if (_sending) {
      console.warn('[Chat] Already sending — ignored');
      return;
    }
    const now = Date.now();
    if (trimmed === _lastSentText && now - _lastSentAt < DEDUP_MS) {
      console.warn('[Chat] Duplicate suppressed:', trimmed.slice(0, 40));
      return;
    }

    _sending = true;
    _lastSentText = trimmed;
    _lastSentAt = now;
    setLoading(true);

    addMessage({ id: uuid(), role: 'user', text: trimmed, timestamp: now });
    clearThinking();

    try {
      const res = await authFetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId }),
      });
      if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
      await readChatStream(res.body, (event) => {
        if (event.type === 'token') useJarvisStore.getState().addThinkingToken(event.token);
        if (event.type === 'done') addMessage({ id: event.id ?? uuid(), role: 'assistant', text: event.text, timestamp: Date.now(), speakable: true });
        if (event.type === 'error') throw new Error(event.message);
      });
    } catch (err) {
      addMessage({ id: uuid(), role: 'assistant', text: `System error: ${err}`, timestamp: Date.now() });
    } finally {
      _sending = false;
      setLoading(false);
    }
  }, [addMessage, clearThinking]);

  return { send, loading };
}
