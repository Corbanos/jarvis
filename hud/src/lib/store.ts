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
  completedAt?: number;
  logs: string[];
  liveText?: string;     // streaming token output
  currentTool?: string;
  summary?: string;
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
  dismissNonce: number;

  setConnected: (v: boolean) => void;
  triggerDismiss: () => void;
  setMessages: (m: ChatMessage[]) => void;
  addMessage: (m: ChatMessage) => void;
  clearMessages: () => void;
  addThinkingToken: (t: string) => void;
  clearThinking: () => void;
  addToolCall: (t: ToolCallRecord) => void;
  markToolDone: (name: string) => void;
  addAgent: (a: AgentRecord) => void;
  updateAgent: (id: string, patch: Partial<AgentRecord> & { logs?: string[] }) => void;
  appendAgentToken: (id: string, token: string) => void;
  setAgentTool: (id: string, tool: string | undefined) => void;
  agentLog: (id: string, log: string) => void;
  completeAgent: (id: string, status: string, summary?: string) => void;
  addTelemetry: (t: TelemetryRecord) => void;
}

export const useJarvisStore = create<JarvisState>((set) => ({
  connected: false,
  messages: [],
  thinkingTokens: '',
  toolCalls: [],
  agents: [],
  telemetry: [],
  dismissNonce: 0,

  setConnected: (v) => set({ connected: v }),

  triggerDismiss: () => set((s) => ({ dismissNonce: s.dismissNonce + 1 })),

  setMessages: (messages) => set({ messages, thinkingTokens: '' }),

  clearMessages: () => set({ messages: [], thinkingTokens: '' }),

  addMessage: (m) =>
    set((s) => ({
      messages: [...s.messages.slice(-100), m],
      thinkingTokens: '',
    })),

  addThinkingToken: (t) => set((s) => ({ thinkingTokens: s.thinkingTokens + t })),
  clearThinking: () => set({ thinkingTokens: '' }),

  addToolCall: (t) =>
    set((s) => ({ toolCalls: [...s.toolCalls.slice(-50), t] })),

  markToolDone: (name) =>
    set((s) => ({
      toolCalls: s.toolCalls.map((t) =>
        t.name === name && (t.status === 'executing' || t.status === 'starting')
          ? { ...t, status: 'done' }
          : t
      ),
    })),

  addAgent: (a) => set((s) => ({ agents: [...s.agents, a] })),

  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const newLogs = patch.logs ? [...a.logs, ...patch.logs] : a.logs;
        return { ...a, ...patch, logs: newLogs };
      }),
    })),

  appendAgentToken: (id, token) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, liveText: (a.liveText ?? '') + token } : a
      ),
    })),

  setAgentTool: (id, tool) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, currentTool: tool } : a
      ),
    })),

  agentLog: (id, logLine) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, logs: [...a.logs, logLine].slice(-50) } : a
      ),
    })),

  completeAgent: (id, status, summary) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id
          ? { ...a, status, summary, currentTool: undefined, completedAt: Date.now() }
          : a
      ),
    })),

  addTelemetry: (t) =>
    set((s) => ({ telemetry: [...s.telemetry.slice(-200), t] })),
}));
