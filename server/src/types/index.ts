export type WSEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'agent_spawn'
  | 'agent_update'
  | 'agent_complete'
  | 'telemetry'
  | 'message'
  | 'error'
  | 'status';

export interface WSEvent {
  type: WSEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface AgentRecord {
  id: string;
  goal: string;
  status: 'spawning' | 'running' | 'complete' | 'failed';
  startedAt: number;
  completedAt?: number;
  logs: string[];
  pid?: number;
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
