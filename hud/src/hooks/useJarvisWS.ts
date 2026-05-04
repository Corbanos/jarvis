'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';

const WS_URL = process.env['NEXT_PUBLIC_JARVIS_WS'] ?? 'ws://localhost:7777/ws';
const MAX_RECONNECT_DELAY = 16000;

export function useJarvisWS() {
  const ws = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(500);
  const addThinkingToken = useJarvisStore((s) => s.addThinkingToken);
  const addToolCall = useJarvisStore((s) => s.addToolCall);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const setConnected = useJarvisStore((s) => s.setConnected);
  const addAgent = useJarvisStore((s) => s.addAgent);
  const updateAgent = useJarvisStore((s) => s.updateAgent);
  const addTelemetry = useJarvisStore((s) => s.addTelemetry);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const socket = new WebSocket(WS_URL);
      ws.current = socket;

      socket.onopen = () => {
        reconnectDelay.current = 500;
        setConnected(true);
      };

      socket.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          switch (event.type) {
            case 'thinking':
              if (event.payload.token) addThinkingToken(event.payload.token as string);
              break;
            case 'tool_call':
              addToolCall({ name: event.payload.name as string, status: event.payload.status as string, input: event.payload.input as Record<string, unknown>, timestamp: event.timestamp });
              break;
            case 'message':
              addMessage({ id: event.payload.id as string, role: 'assistant', text: event.payload.text as string, timestamp: event.timestamp });
              break;
            case 'agent_spawn':
              addAgent({ id: event.payload.id as string, goal: event.payload.goal as string, status: 'spawning', startedAt: event.timestamp, logs: [] });
              break;
            case 'agent_update':
              updateAgent(event.payload.id as string, { status: event.payload.status as string, logs: event.payload.log ? [event.payload.log as string] : [] });
              break;
            case 'agent_complete':
              updateAgent(event.payload.id as string, { status: event.payload.status as string });
              break;
            case 'telemetry':
              addTelemetry({ source: event.payload.source as string, event: event.payload.event as string, data: event.payload.data as Record<string, unknown>, timestamp: event.timestamp });
              break;
          }
        } catch { /* ignore parse errors */ }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          setTimeout(connect, reconnectDelay.current);
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
        }
      };

      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      cancelled = true;
      ws.current?.close();
    };
  }, [addThinkingToken, addToolCall, addMessage, setConnected, addAgent, updateAgent, addTelemetry]);
}
