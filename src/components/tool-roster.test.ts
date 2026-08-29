import { describe, expect, it } from "vitest";
import { createMapTools } from "@/lib/map-tools";
import { createMemoryToolStore } from "@/lib/store/map-store";
import { IMPERATIVE_TOOLS } from "./tool-roster";

/**
 * The landing screen prints the tool names as a promise to whoever connects an
 * agent. If the tool layer gains, loses or renames a tool, the promise has to
 * move with it — a chip for a tool that no longer answers is worse than no chip.
 */
describe("TOOL_ROSTER", () => {
  it("names exactly the imperatively registered tools", () => {
    const registered = createMapTools(createMemoryToolStore()).map((tool) => tool.name);
    expect([...IMPERATIVE_TOOLS].sort()).toEqual([...registered].sort());
  });
});
