/**
 * Trace context management using AsyncLocalStorage
 * Maintains trace ID throughout the request lifecycle
 */

import { AsyncLocalStorage } from 'async_hooks';

interface TraceContext {
  traceId: string;
  clientId?: string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Get the current trace context
 */
export function getTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

/**
 * Get the current trace ID
 */
export function getTraceId(): string | undefined {
  return traceContextStorage.getStore()?.traceId;
}

/**
 * Run a function within a trace context
 */
export function runWithTraceContext<T>(
  context: TraceContext,
  fn: () => T,
): T {
  return traceContextStorage.run(context, fn);
}

/**
 * Run an async function within a trace context
 */
export async function runWithTraceContextAsync<T>(
  context: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return traceContextStorage.run(context, fn);
}

