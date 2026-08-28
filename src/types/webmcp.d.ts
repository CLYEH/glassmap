// Ambient types for the WebMCP API (spec draft + Chrome docs, checked 2026-08-28).
// Spec:   https://webmachinelearning.github.io/webmcp/
// Chrome: https://developer.chrome.com/docs/ai/webmcp/imperative-api

interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface ToolExecuteCallbackOptions {
  signal: AbortSignal;
}

// Spec says Promise<any>; Chrome samples return a string. We always return a string.
type ToolExecuteCallback = (
  input: Record<string, unknown>,
  options: ToolExecuteCallbackOptions,
) => Promise<unknown> | unknown;

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute: ToolExecuteCallback;
  annotations?: ToolAnnotations;
}

interface ModelContextRegisterToolOptions {
  exposedTo?: string[];
  signal?: AbortSignal;
}

interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  window?: Window;
  origin?: string;
  annotations?: ToolAnnotations;
}

/** Current spec / Chrome shape (document.modelContext). */
interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    input?: object,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
}

/** Older shape some clients still expose (navigator.modelContext). */
interface LegacyModelContext {
  registerTool(tool: ModelContextTool): unknown;
  unregisterTool?(name: string): unknown;
  provideContext?(ctx: { tools: ModelContextTool[] }): unknown;
  clearContext?(): unknown;
}

interface Document {
  modelContext?: ModelContext;
}

interface Navigator {
  modelContext?: ModelContext | LegacyModelContext;
}
