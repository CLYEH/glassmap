/**
 * Dev-only shim implementing the current `ModelContext` surface
 * (registerTool / getTools / executeTool / toolchange) so tools can be
 * exercised in any browser without the Chrome flag or the ChatGPT app.
 *
 * Never installed when a native `document.modelContext` exists.
 */
export function createModelContextShim(): ModelContext {
  const tools = new Map<string, ModelContextTool>();
  const target = new EventTarget();

  const emitChange = () => target.dispatchEvent(new Event("toolchange"));

  const ctx: ModelContext = Object.assign(target, {
    ontoolchange: null as ModelContext["ontoolchange"],
    async registerTool(
      tool: ModelContextTool,
      options?: ModelContextRegisterToolOptions,
    ): Promise<void> {
      if (!tool?.name) throw new TypeError("tool.name is required");
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) {
          tools.delete(tool.name);
          emitChange();
        }
      });
      emitChange();
    },
    async getTools(): Promise<RegisteredTool[]> {
      return [...tools.values()].map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        window: typeof window === "undefined" ? undefined : window,
        origin: typeof location === "undefined" ? undefined : location.origin,
      }));
    },
    async executeTool(
      tool: RegisteredTool,
      input: object = {},
      options?: { signal?: AbortSignal },
    ): Promise<string> {
      const t = tools.get(tool.name);
      if (!t) throw new Error(`Unknown tool: ${tool.name}`);
      const signal = options?.signal ?? new AbortController().signal;
      const result = await t.execute(input as Record<string, unknown>, { signal });
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  });

  target.addEventListener("toolchange", (ev) => ctx.ontoolchange?.call(ctx, ev));
  return ctx;
}
