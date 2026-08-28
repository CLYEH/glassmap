import { describe, expect, it, vi } from "vitest";
import { createModelContextShim } from "./shim";

const echo: ModelContextTool = {
  name: "echo",
  description: "echo input",
  inputSchema: { type: "object" },
  execute: (input) => ({ got: input }),
};

describe("ModelContext shim (mirrors spec surface so dev tests transfer to real clients)", () => {
  it("registerTool → getTools lists the tool without its execute function", async () => {
    const ctx = createModelContextShim();
    await ctx.registerTool(echo);
    const tools = await ctx.getTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    expect(tools[0]).not.toHaveProperty("execute");
  });

  it("executeTool stringifies non-string results (Chrome returns DOMString)", async () => {
    const ctx = createModelContextShim();
    await ctx.registerTool(echo);
    const [tool] = await ctx.getTools();
    expect(await ctx.executeTool(tool, { a: 1 })).toBe('{"got":{"a":1}}');
  });

  it("aborting the registration signal unregisters and fires toolchange", async () => {
    const ctx = createModelContextShim();
    const onChange = vi.fn();
    ctx.addEventListener("toolchange", onChange);
    const ac = new AbortController();
    await ctx.registerTool(echo, { signal: ac.signal });
    expect(onChange).toHaveBeenCalledTimes(1);
    ac.abort();
    expect(await ctx.getTools()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("re-registering the same name replaces the tool", async () => {
    const ctx = createModelContextShim();
    await ctx.registerTool(echo);
    await ctx.registerTool({ ...echo, execute: () => "v2" });
    const [tool] = await ctx.getTools();
    expect(await ctx.executeTool(tool)).toBe("v2");
  });
});
