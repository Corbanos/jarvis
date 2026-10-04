import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** Only a response received on this page's own chat HTTP request may speak. */
  speakable?: boolean;
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
  model?: string;
  projectId?: string;
  parentAgentId?: string;
  role?: string;
  // Resume / steer state, kept live from the agent_update WS feed.
  iterations?: number;
  resumeCount?: number;
  lastError?: string;
  /** 'pause' | 'stop' asked for but not yet reached (loop is mid-iteration). */
  pendingControl?: string | null;
  /** Interjections queued but not yet handed to the model. */
  pendingInstructions?: string[];
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
  
  // Model state
  currentModel: string;
  availableModels: string[];
  
  // Focused agent for Agent Control Panel
  focusedAgentId: string | null;

  // Active project (chat-context binding)
  activeProjectId: string | null;
  activeProjectName: string | null;
  setActiveProject: (p: { id: string; name: string } | null) => void;

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
  setAgents: (agents: AgentRecord[]) => void;
  clearAgentHistory: () => void;
  addTelemetry: (t: TelemetryRecord) => void;
  
  // Model management
  setCurrentModel: (model: string) => void;
  setAvailableModels: (models: string[]) => void;
  
  // Agent focus
  setFocusedAgent: (id: string | null) => void;
}

export const useJarvisStore = create<JarvisState>((set) => ({
  connected: false,
  messages: [],
  thinkingTokens: '',
  toolCalls: [],
  agents: [],
  telemetry: [],
  dismissNonce: 0,
  currentModel: 'claude-opus-5',
  // Initial render only — the server's /api/model list replaces this on load.
  availableModels: [
    'claude-opus-5',
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  focusedAgentId: null,
  activeProjectId: null,
  activeProjectName: null,

  setConnected: (v) => set({ connected: v }),

  triggerDismiss: () => set((s) => ({ dismissNonce: s.dismissNonce + 1 })),

  setMessages: (messages) => set({ messages, thinkingTokens: '' }),

  clearMessages: () => set({ messages: [], thinkingTokens: '' }),

  addMessage: (m) =>
    set((s) => ({
      messages: [...s.messages.slice(-100), m],
      thinkingTokens: m.role === 'user' || m.speakable ? '' : s.thinkingTokens,
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

  addAgent: (a) => set((s) => {
    // Check if agent already exists (from history load)
    const existing = s.agents.find(ag => ag.id === a.id);
    if (existing) {
      return { agents: s.agents.map(ag => ag.id === a.id ? { ...ag, ...a } : ag) };
    }
    return { agents: [...s.agents, a] };
  }),

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

  setAgents: (agents) => set({ agents }),

  clearAgentHistory: () =>
    set((s) => {
      // Mirrors the server: running and paused agents are kept, since a paused
      // agent is unfinished work that can still be resumed.
      const keep = (status: string) => status === 'running' || status === 'spawning' || status === 'paused';
      return {
        agents: s.agents.filter((a) => keep(a.status)),
        focusedAgentId: keep(s.agents.find((a) => a.id === s.focusedAgentId)?.status ?? '')
          ? s.focusedAgentId
          : null,
      };
    }),

  addTelemetry: (t) =>
    set((s) => ({ telemetry: [...s.telemetry.slice(-200), t] })),

  setCurrentModel: (model) => set({ currentModel: model }),
  
  setAvailableModels: (models) => set({ availableModels: models }),
  
  setFocusedAgent: (id) => set({ focusedAgentId: id }),

  setActiveProject: (p) => set({ activeProjectId: p?.id ?? null, activeProjectName: p?.name ?? null }),
}));
