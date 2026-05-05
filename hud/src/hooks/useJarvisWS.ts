'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { emitWorldviewEvent } from '@/components/Worldview';

const WS_URL = process.env['NEXT_PUBLIC_JARVIS_WS'] ?? 'ws://localhost:7777/ws';
const MAX_RECONNECT_DELAY = 16000;

export function useJarvisWS() {
  const ws = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(500);

  const addThinkingToken = useJarvisStore((s) => s.addThinkingToken);
  const addToolCall = useJarvisStore((s) => s.addToolCall);
  const markToolDone = useJarvisStore((s) => s.markToolDone);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const setConnected = useJarvisStore((s) => s.setConnected);
  const addAgent = useJarvisStore((s) => s.addAgent);
  const updateAgent = useJarvisStore((s) => s.updateAgent);
  const appendAgentToken = useJarvisStore((s) => s.appendAgentToken);
  const setAgentTool = useJarvisStore((s) => s.setAgentTool);
  const agentLog = useJarvisStore((s) => s.agentLog);
  const completeAgent = useJarvisStore((s) => s.completeAgent);
  const triggerDismiss = useJarvisStore((s) => s.triggerDismiss);
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
            case 'tool_result':
              markToolDone(event.payload.name as string);
              break;
            case 'message':
              addMessage({ id: event.payload.id as string, role: 'assistant', text: event.payload.text as string, timestamp: event.timestamp });
              break;
            case 'agent_spawn':
              addAgent({
                id: event.payload.id as string,
                goal: event.payload.goal as string,
                status: 'running',
                startedAt: event.timestamp,
                logs: [],
                liveText: '',
              });
              break;
            case 'agent_update':
              updateAgent(event.payload.id as string, {
                status: event.payload.status as string,
                logs: event.payload.log ? [event.payload.log as string] : [],
              });
              break;
            case 'agent_token':
              appendAgentToken(event.payload.id as string, event.payload.token as string);
              break;
            case 'agent_tool':
              setAgentTool(event.payload.id as string, event.payload.tool as string);
              agentLog(event.payload.id as string, `▶ ${event.payload.tool}(${truncate(JSON.stringify(event.payload.input ?? {}), 80)})`);
              break;
            case 'agent_tool_result':
              setAgentTool(event.payload.id as string, undefined);
              agentLog(event.payload.id as string, `  ← ${truncate(event.payload.result as string ?? '', 120)}`);
              break;
            case 'agent_complete':
              completeAgent(
                event.payload.id as string,
                event.payload.status as string,
                event.payload.summary as string | undefined
              );
              // Surface in chat as a system message
              addMessage({
                id: `agent-${event.payload.id}`,
                role: 'assistant',
                text: agentCompletionMessage(event.payload),
                timestamp: event.timestamp,
              });
              break;
            case 'dismiss':
              triggerDismiss();
              break;
            case 'worldview':
              emitWorldviewEvent(event.payload as { action: string; lat?: number; lon?: number; name?: string });
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
  }, [addThinkingToken, addToolCall, markToolDone, addMessage, setConnected, addAgent, updateAgent, appendAgentToken, setAgentTool, agentLog, completeAgent, triggerDismiss, addTelemetry]);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function agentCompletionMessage(payload: Record<string, unknown>): string {
  const status = payload['status'] as string;
  const goal = (payload['goal'] as string)?.slice(0, 80) ?? 'task';
  const summary = (payload['summary'] as string) ?? '';
  const dur = payload['duration'] as number | undefined;
  const durStr = dur ? ` (${(dur / 1000).toFixed(1)}s)` : '';

  if (status === 'complete') {
    return `Sub-agent finished, sir${durStr}.\n\n**${goal}**\n\n${summary}`;
  }
  return `Sub-agent failed${durStr}: ${summary || 'unknown reason'}`;
}
