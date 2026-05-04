import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ToolCallRecord {
  name: string;
  status: string;
  input?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentRecord {
  id: string;
  goal: string;
  status: string;
  startedAt: number;
  logs: string[];
}

export interface TelemetryRecord {
  source: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface JarvisState {
  connected: boolean;
  messages: ChatMessage[];
  thinkingTokens: string;
  toolCalls: ToolCallRecord[];
  agents: AgentRecord[];
  telemetry: TelemetryRecord[];

  setConnected: (v: boolean) => void;
  addMessage: (m: ChatMessage) => void;
  addThinkingToken: (t: string) => void;
  clearThinking: () => void;
  addToolCall: (t: ToolCallRecord) => void;
  addAgent: (a: AgentRecord) => void;
  updateAgent: (id: string, patch: Partial<AgentRecord> & { logs?: string[] }) => void;
  addTelemetry: (t: TelemetryRecord) => void;
}

export const useJarvisStore = create<JarvisState>((set) => ({
  connected: false,
  messages: [],
  thinkingTokens: '',
  toolCalls: [],
  agents: [],
  telemetry: [],

  setConnected: (v) => set({ connected: v }),

  addMessage: (m) =>
    set((s) => ({
      messages: [...s.messages.slice(-100), m],
      thinkingTokens: '',
    })),

  addThinkingToken: (t) => set((s) => ({ thinkingTokens: s.thinkingTokens + t })),
  clearThinking: () => set({ thinkingTokens: '' }),

  addToolCall: (t) =>
    set((s) => ({ toolCalls: [...s.toolCalls.slice(-50), t] })),

  addAgent: (a) => set((s) => ({ agents: [...s.agents, a] })),

  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const newLogs = patch.logs ? [...a.logs, ...patch.logs] : a.logs;
        return { ...a, ...patch, logs: newLogs };
      }),
    })),

  addTelemetry: (t) =>
    set((s) => ({ telemetry: [...s.telemetry.slice(-200), t] })),
}));
