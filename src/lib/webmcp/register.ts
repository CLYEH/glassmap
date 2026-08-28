import type { GlassMapTool } from "./types";
import { createModelContextShim } from "./shim";

export type Surface = "document.modelContext" | "navigator.modelContext" | "shim";

export interface RegistrationInfo {
  surfaces: Surface[];
  toolNames: string[];
  unregister: () => void;
}

/** Test/dev hook on window so Playwright / Chrome MCP can call tools directly. */
export interface GlassMapDebug {
  surfaces: Surface[];
  list: () => string[];
  call: (name: string, input?: Record<string, unknown>) => Promise<string>;
}

declare global {
  interface Window {
    __glassmap?: GlassMapDebug;
  }
}

function stringify(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

function toModelContextTool(tool: GlassMapTool): ModelContextTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    async execute(input, opts) {
      return stringify(await tool.execute(input, opts));
    },
  };
}

function isCurrentShape(x: ModelContext | LegacyModelContext): x is ModelContext {
  return typeof (x as ModelContext).getTools === "function";
}

/**
 * Register tools on every WebMCP surface present. Feature-detects:
 *  - document.modelContext  (current spec / Chrome)
 *  - navigator.modelContext (older shape; may be the same object as above)
 *  - neither → install the dev shim on document.modelContext (if allowed)
 */
export function registerTools(
  tools: GlassMapTool[],
  opts: { allowShim?: boolean } = {},
): RegistrationInfo {
  const allowShim = opts.allowShim ?? process.env.NODE_ENV !== "production";
  const controller = new AbortController();
  const surfaces: Surface[] = [];
  const legacyRegistered: LegacyModelContext[] = [];
  const mcTools = tools.map(toModelContextTool);

  let docCtx = document.modelContext;
  const navCtx = navigator.modelContext;

  if (!docCtx && !navCtx && allowShim) {
    docCtx = createModelContextShim();
    document.modelContext = docCtx;
    surfaces.push("shim");
  }

  if (docCtx) {
    for (const t of mcTools) void docCtx.registerTool(t, { signal: controller.signal });
    if (!surfaces.includes("shim")) surfaces.push("document.modelContext");
  }

  if (navCtx && (navCtx as unknown) !== (docCtx as unknown)) {
    if (isCurrentShape(navCtx)) {
      for (const t of mcTools) void navCtx.registerTool(t, { signal: controller.signal });
    } else {
      for (const t of mcTools) navCtx.registerTool(t);
      legacyRegistered.push(navCtx);
    }
    surfaces.push("navigator.modelContext");
  }

  const byName = new Map(tools.map((t) => [t.name, t]));
  window.__glassmap = {
    surfaces,
    list: () => [...byName.keys()],
    async call(name, input = {}) {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown tool: ${name}`);
      return stringify(await t.execute(input, { signal: new AbortController().signal }));
    },
  };

  return {
    surfaces,
    toolNames: [...byName.keys()],
    unregister: () => {
      controller.abort();
      for (const l of legacyRegistered) for (const t of tools) l.unregisterTool?.(t.name);
      delete window.__glassmap;
    },
  };
}
