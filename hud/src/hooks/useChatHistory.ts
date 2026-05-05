'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface HistoryResponse {
  sessionId: string;
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>;
}

/**
 * Loads chat history from the server on mount.
 * The server is the source of truth (SQLite persistent across restarts).
 */
export function useChatHistory(sessionId = 'default') {
  const setMessages = useJarvisStore((s) => s.setMessages);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    authFetch(`${API}/api/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=100`)
      .then((r) => r.json())
      .then((data: HistoryResponse) => {
        if (!data.messages?.length) return;
        const restored = data.messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text: m.content,
          timestamp: m.timestamp,
        }));
        setMessages(restored);
        console.log(`[History] Loaded ${restored.length} messages from session "${sessionId}"`);
      })
      .catch((e) => console.warn('[History] Load failed:', e));
  }, [sessionId, setMessages]);
}

export async function clearChatHistory(sessionId = 'default'): Promise<void> {
  await authFetch(`${API}/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}
