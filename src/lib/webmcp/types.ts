/**
 * App-level tool definition, independent of which WebMCP surface is present.
 * `execute` returns a JSON-serialisable value; the registration layer
 * stringifies it because a string is the lowest common denominator across clients.
 */
export interface GlassMapTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: I, opts: { signal: AbortSignal }) => Promise<unknown> | unknown;
}
