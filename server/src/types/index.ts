export type WSEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'agent_spawn'
  | 'agent_update'
  | 'agent_token'
  | 'agent_tool'
  | 'agent_tool_result'
  | 'agent_complete'
  | 'agent_instruction'
  | 'agent_instruction_queued'
  | 'agent_resume'
  | 'agent_control'
  | 'model_changed'
  | 'jarvis_model_changed'
  | 'agents_history_cleared'
  | 'telemetry'
  | 'message'
  | 'error'
  | 'status'
  | 'dismiss'
  | 'worldview'
  | 'module'
  | 'card';

export interface WSEvent {
  type: WSEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type AgentStatus = 'spawning' | 'running' | 'complete' | 'failed' | 'paused' | 'stopped';

/** Cooperative control request, honoured between loop iterations. */
export type AgentControl = 'pause' | 'stop';

export interface AgentRecord {
  id: string;
  goal: string;
  status: AgentStatus;
  startedAt: number;
  completedAt?: number;
  logs: string[];
  pid?: number;
  model?: string;
  projectId?: string;       // Link to a project, if any
  parentAgentId?: string;   // For multi-agent / manager-worker setups
  role?: string;            // e.g. 'manager', 'worker', 'debug', 'builder'
  summary?: string;         // Short one-line summary saved on completion
  iterations?: number;      // Cumulative loop iterations, survives resume
  lastError?: string;       // Why the last run ended (provider 429, crash, ...)
  resumeCount?: number;     // How many times this agent has been resumed
  /** Queued operator interjections not yet handed to the model. */
  pendingInstructions?: string[];
  /** A pause/stop asked for but not yet reached (loop is mid-iteration). */
  pendingControl?: AgentControl;
  /** Log of tool invocations, kept for the resume transcript + HUD. */
  toolCalls?: Array<{ tool: string; at: number; preview?: string }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface TelemetryEvent {
  source: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}
