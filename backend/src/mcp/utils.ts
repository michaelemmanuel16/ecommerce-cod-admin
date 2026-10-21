import * as Money from '../utils/money';
import type { ToolResult } from '../tools/registry';

// MCP response helpers
export function mcpJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, Money.jsonReplacer, 2) }] };
}

export function mcpError(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

/** MCP error for a limited call. The text and structuredContent both carry retryAfterSeconds. */
export function mcpRateLimited(retryAfterSeconds: number) {
  return {
    ...mcpError(`Rate limit exceeded. Please wait before making more requests. Retry after ${retryAfterSeconds} seconds.`),
    structuredContent: { code: 'RATE_LIMITED', retryAfterSeconds },
  };
}

/** A tool result as an MCP response: the data as JSON text, or the error message with isError. */
export function toMcpResult(result: ToolResult) {
  return result.status === 'ok' ? mcpJson(result.data) : mcpError(result.error);
}
