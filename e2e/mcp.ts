import type { Page } from "@playwright/test";
import type { ToolResult } from "./types";

/**
 * Calls one tool through `document.modelContext.getTools()` /
 * `executeTool()` -- the same two calls a real WebMCP client makes -- and
 * parses the JSON string every tool returns. Re-fetches the tool list on
 * every call rather than caching a reference, so a stale registration can
 * never mask a bug.
 */
export async function callTool(
  page: Page,
  name: string,
  input: Record<string, unknown> = {},
): Promise<ToolResult> {
  return page.evaluate<ToolResult, { name: string; input: Record<string, unknown> }>(
    async ({ name, input }) => {
      const ctx = document.modelContext!;
      const tools = await ctx.getTools();
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`tool not registered: ${name}`);
      return JSON.parse(await ctx.executeTool(tool, input));
    },
    { name, input },
  );
}
