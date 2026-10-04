import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/** Context follows promises/tool execution, never a mutable 'last requester'. */
export interface RequestContext {
  clientId?: string;
  requestId?: string;
  sessionId?: string;
  inlineRetrieval?: boolean;
}
export const requestContext = new AsyncLocalStorage<RequestContext>();
export function validIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : undefined;
}
export function contextFromRequest(request: FastifyRequest): RequestContext {
  return {
    clientId: validIdentity(request.headers['x-jarvis-client-id']),
    requestId: randomUUID(),
    sessionId: validIdentity(request.headers['x-jarvis-session-id']),
  };
}
export function conversationSession(request: FastifyRequest, name = 'default'): string {
  const ctx = contextFromRequest(request);
  return `${ctx.sessionId ?? ctx.clientId ?? 'legacy'}:${name.slice(0, 128)}`;
}
