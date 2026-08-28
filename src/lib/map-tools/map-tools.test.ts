import { describe, expect, it } from "vitest";
import { createMapTools, validateSetMapView } from "./index";
import { createMemoryToolStore, DEFAULT_VIEW } from "@/lib/store/map-store";

const signal = new AbortController().signal;
const toolsFor = (store = createMemoryToolStore()) => {
  const tools = createMapTools(store);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { store, tools, byName };
};

describe("tool contract", () => {
  it("read tools are marked readOnlyHint so clients skip confirmation; write tools are not", () => {
    const { byName } = toolsFor();
    expect(byName.get_map_state.annotations?.readOnlyHint).toBe(true);
    expect(byName.set_map_view.annotations?.readOnlyHint).toBeFalsy();
  });

  it("every tool has a JSON-schema object inputSchema (clients reject tools without one)", () => {
    for (const t of toolsFor().tools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });
});

describe("get_map_state", () => {
  it("returns coordinates rounded to 5 decimals to keep token cost low", async () => {
    const store = createMemoryToolStore({ ...DEFAULT_VIEW, center: [121.123456789, 25.987654321] });
    const out = await toolsFor(store).byName.get_map_state.execute({}, { signal });
    expect(out).toEqual({
      center: { lng: 121.12346, lat: 25.98765 },
      zoom: DEFAULT_VIEW.zoom,
      bearing: 0,
      pitch: 0,
    });
  });
});

describe("set_map_view", () => {
  it("writes to the store and returns the new state (agent needs no follow-up read)", async () => {
    const { store, byName } = toolsFor();
    const out = await byName.set_map_view.execute(
      { center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 },
      { signal },
    );
    expect(store.getView().zoom).toBe(15);
    expect(out).toMatchObject({ center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 });
  });

  it("returns a structured error (not a throw) on bad input, and leaves state untouched", async () => {
    const { store, byName } = toolsFor();
    const before = store.getView();
    const out = (await byName.set_map_view.execute({ zoom: 99 }, { signal })) as { error?: string };
    expect(out.error).toMatch(/zoom/);
    expect(store.getView()).toEqual(before);
  });

  it("normalises bearing into 0..360", () => {
    const v = validateSetMapView({ bearing: -90 });
    expect(v).toEqual({ patch: { bearing: 270 } });
  });

  it("rejects an empty call so the agent does not think it did something", () => {
    expect(validateSetMapView({})).toHaveProperty("error");
  });
});
