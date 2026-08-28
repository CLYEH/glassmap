import { describe, expect, it } from "vitest";
import { createMapTools, PLACE_ZOOM, validateSetMapView } from "./index";
import { createMemoryToolStore, DEFAULT_VIEW } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { FeatureOutput } from "./output";
import type { MapStateOutput } from "./state";
import { DEFAULT_LIMIT, DEFAULT_RADIUS_M } from "./query";
import { FIXTURE_FEATURES, IN_VIEW_IDS_BY_DISTANCE, VIEW, VIEW_BOUNDS } from "./test-fixtures";

const signal = new AbortController().signal;
const toolsFor = (store = createMemoryToolStore()) => {
  const tools = createMapTools(store);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { store, tools, byName };
};

/** A store holding the Taipei fixture with the map already rendered. */
const mapReady = (over: Partial<Parameters<typeof createMemoryToolStore>[0]> = {}) =>
  toolsFor(
    createMemoryToolStore({ features: FIXTURE_FEATURES, bounds: VIEW_BOUNDS, view: VIEW, ...over }),
  );

/** Every tool result is a plain JSON object; this is the union of fields we assert on. */
interface ToolResult {
  [key: string]: unknown;
  error?: string;
  candidates?: { id: string; name: string; name_en?: string; category: string }[];
  total?: number;
  returned?: number;
  features?: FeatureOutput[];
  selected?: FeatureOutput[];
  unknown_ids?: string[];
  state?: MapStateOutput;
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const idsOf = (features: FeatureOutput[] | undefined) => (features ?? []).map((f) => f.id);

describe("tool contract", () => {
  it("read tools are marked readOnlyHint so clients skip confirmation; write tools are not", () => {
    const { byName } = toolsFor();
    expect(byName.get_map_state.annotations?.readOnlyHint).toBe(true);
    expect(byName.list_features_in_view.annotations?.readOnlyHint).toBe(true);
    expect(byName.find_features.annotations?.readOnlyHint).toBe(true);
    expect(byName.set_map_view.annotations?.readOnlyHint).toBeFalsy();
  });

  it("marks untrustedContentHint on every tool that can echo OSM or user text", () => {
    // Names come from OpenStreetMap and from sample listings; a client must be
    // able to treat them as data, not as instructions.
    const { byName } = toolsFor();
    for (const name of ["set_map_view", "list_features_in_view", "find_features"]) {
      expect(byName[name].annotations?.untrustedContentHint, name).toBe(true);
    }
    // get_map_state returns numbers and ids only, so it needs no such hint.
    expect(byName.get_map_state.annotations?.untrustedContentHint).toBeFalsy();
  });

  it("every tool has a closed JSON-schema object and describes each property", () => {
    for (const t of toolsFor().tools) {
      const schema = t.inputSchema as {
        type: string;
        additionalProperties?: boolean;
        properties: Record<string, { description?: string }>;
      };
      expect(schema, t.name).toMatchObject({ type: "object", additionalProperties: false });
      for (const [prop, spec] of Object.entries(schema.properties)) {
        // An LLM fills these in from the schema alone; an undescribed property is unusable.
        expect(spec.description, `${t.name}.${prop}`).toBeTruthy();
      }
    }
  });

  it("uses ASCII snake_case tool names, which is all every client is known to accept", () => {
    for (const t of toolsFor().tools) expect(t.name).toMatch(/^[a-z0-9_]+$/);
  });

  it("never throws on hostile input; it returns an error object", async () => {
    for (const t of toolsFor().tools) {
      const out = await call(t, { zoom: "banana", limit: -1, ids: 7, near: true, categories: "park" });
      expect(typeof out, t.name).toBe("object");
    }
  });
});

describe("get_map_state", () => {
  it("returns coordinates rounded to 5 decimals to keep token cost low", async () => {
    const store = createMemoryToolStore({ view: { ...DEFAULT_VIEW, center: [121.123456789, 25.987654321] } });
    const out = await call(toolsFor(store).byName.get_map_state);
    expect(out).toMatchObject({
      center: { lng: 121.12346, lat: 25.98765 },
      zoom: DEFAULT_VIEW.zoom,
      bearing: 0,
      pitch: 0,
    });
  });

  it("reports bounds, selection and how much data is loaded in one read", async () => {
    const { byName } = mapReady({ selection: ["osm:node:2"] });
    expect(await call(byName.get_map_state)).toMatchObject({
      bounds: { west: 121.525, south: 25.02, east: 121.55, north: 25.045 },
      selection: { count: 1, ids: ["osm:node:2"] },
      features_loaded: FIXTURE_FEATURES.length,
    });
  });

  it("reports bounds: null before the map has rendered, instead of inventing an extent", async () => {
    const out = await call(toolsFor().byName.get_map_state);
    expect(out.bounds).toBeNull();
    expect(out.features_loaded).toBe(0);
  });

  it("has exactly the shape write tools return, so the e2e round-trip stays valid", async () => {
    const { byName } = mapReady();
    const read = await call(byName.get_map_state);
    const written = await call(byName.set_map_view, { zoom: 16 });
    expect(Object.keys(written).sort()).toEqual(Object.keys(read).sort());
  });
});

describe("set_map_view", () => {
  it("writes to the store and returns the new state (agent needs no follow-up read)", async () => {
    const { store, byName } = toolsFor();
    const out = await call(byName.set_map_view, { center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 });
    expect(store.getView().zoom).toBe(15);
    expect(out).toMatchObject({ center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 });
  });

  it("returns a structured error (not a throw) on bad input, and leaves state untouched", async () => {
    const { store, byName } = toolsFor();
    const before = store.getView();
    const out = await call(byName.set_map_view, { zoom: 99 });
    expect(out.error).toMatch(/zoom/);
    expect(store.getView()).toEqual(before);
  });

  it("normalises bearing into 0..360", () => {
    const v = validateSetMapView({ bearing: -90 });
    expect(v).toEqual({ patch: { bearing: 270 } });
  });

  it("rejects an empty call so the agent does not think it did something", async () => {
    expect(validateSetMapView({})).toHaveProperty("error");
    const { byName } = toolsFor();
    expect((await call(byName.set_map_view)).error).toMatch(/provide at least one/);
  });

  it("flies to a named place at neighbourhood zoom without being given coordinates", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { place: "Daan Station" });
    expect(store.getView().center).toEqual([121.5436, 25.0334]);
    expect(out).toMatchObject({ center: { lng: 121.5436, lat: 25.0334 }, zoom: PLACE_ZOOM });
  });

  it("lets an explicit zoom override the place default", async () => {
    const { store, byName } = mapReady();
    await call(byName.set_map_view, { place: "Daan Station", zoom: 18 });
    expect(store.getView().zoom).toBe(18);
  });

  it("does not move for an ambiguous place; it asks with candidates", async () => {
    const { store, byName } = mapReady();
    const before = store.getView();
    const out = await call(byName.set_map_view, { place: "PX Mart" });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    // The map must be exactly where it was: a wrong jump is invisible to the agent.
    expect(store.getView()).toEqual(before);
  });

  it("caps candidates at five so an unlucky query cannot flood the context", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...FIXTURE_FEATURES[6],
      properties: { ...FIXTURE_FEATURES[6].properties, id: `osm:node:9${i}` },
    }));
    const { byName } = mapReady({ features: many });
    const out = await call(byName.set_map_view, { place: "PX Mart" });
    expect(out.candidates).toHaveLength(5);
  });

  it("reports an unknown place with the unchanged state instead of guessing", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { place: "Shibuya" });
    expect(out.error).toBe("unknown place");
    expect(out.state).toMatchObject({ center: { lng: 121.5375, lat: 25.0325 } });
    expect(store.getView()).toEqual(VIEW);
  });

  it("accepts a feature_id, which is how an agent resolves an ambiguous place", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { feature_id: "osm:node:32" });
    expect(store.getView().center).toEqual([121.512, 25.05]);
    expect(out.error).toBeUndefined();
  });

  it("reports an unknown feature_id", async () => {
    const { store, byName } = mapReady();
    expect((await call(byName.set_map_view, { feature_id: "osm:node:404" })).error).toBe(
      "unknown feature_id",
    );
    expect(store.getView()).toEqual(VIEW);
  });

  it("refuses contradictory targets rather than silently preferring one", async () => {
    const { store, byName } = mapReady();
    const both = await call(byName.set_map_view, { place: "Daan Station", feature_id: "osm:node:1" });
    expect(both.error).toMatch(/either place or feature_id/);
    const withCenter = await call(byName.set_map_view, {
      place: "Daan Station",
      center: { lng: 121.5, lat: 25 },
    });
    expect(withCenter.error).toMatch(/either center or place/);
    expect(store.getView()).toEqual(VIEW);
  });
});

describe("list_features_in_view", () => {
  it("says the map is not ready instead of pretending nothing is nearby", async () => {
    const { byName } = mapReady({ bounds: null });
    expect(await call(byName.list_features_in_view)).toEqual({ error: "map not ready" });
  });

  it("returns only what overlaps the viewport, nearest to the centre first", async () => {
    const { byName } = mapReady();
    const out = await call(byName.list_features_in_view);
    expect(idsOf(out.features)).toEqual(IN_VIEW_IDS_BY_DISTANCE);
    expect(out.total).toBe(IN_VIEW_IDS_BY_DISTANCE.length);
    expect(out.returned).toBe(IN_VIEW_IDS_BY_DISTANCE.length);
  });

  it("includes an area that only partly overlaps the viewport", async () => {
    // A district is larger than the screen; excluding it would hide the answer
    // to "which district am I looking at?".
    const { byName } = mapReady();
    expect(idsOf((await call(byName.list_features_in_view)).features)).toContain("district:daan");
  });

  it("filters by category so 'what parks can I see' does not return supermarkets", async () => {
    const { byName } = mapReady();
    const out = await call(byName.list_features_in_view, { categories: ["park", "mrt_station"] });
    expect(idsOf(out.features)).toEqual(["osm:node:3", "osm:way:10", "osm:node:2"]);
  });

  it("rejects a category that is not in the schema, listing what was wrong", async () => {
    const { byName } = mapReady();
    expect((await call(byName.list_features_in_view, { categories: ["cafe"] })).error).toMatch(/cafe/);
  });

  it("honours limit while still reporting the true total", async () => {
    const { byName } = mapReady();
    const out = await call(byName.list_features_in_view, { limit: 2 });
    expect(out.returned).toBe(2);
    expect(out.total).toBe(IN_VIEW_IDS_BY_DISTANCE.length);
    expect(idsOf(out.features)).toEqual(IN_VIEW_IDS_BY_DISTANCE.slice(0, 2));
  });

  it("reports distance and direction from the view centre, and no geometry at all", async () => {
    const { byName } = mapReady();
    const out = await call(byName.list_features_in_view, { limit: 1 });
    expect(out.features?.[0]).toMatchObject({ id: "listing:1", direction: "SW", sample: true });
    expect(out.features?.[0].distance_m).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry/);
  });
});

describe("find_features", () => {
  it("searches the whole dataset, not just the viewport", async () => {
    const { byName } = mapReady();
    const out = await call(byName.find_features, { categories: ["supermarket"] });
    // One of the two PX Marts is off screen; list_features_in_view would miss it.
    expect(idsOf(out.features).sort()).toEqual(["osm:node:30", "osm:node:32"]);
  });

  it("matches a name substring in either language, case-insensitively", async () => {
    const { byName } = mapReady();
    expect(idsOf((await call(byName.find_features, { query: "peace" })).features)).toEqual([
      "osm:way:11",
    ]);
    expect(idsOf((await call(byName.find_features, { query: "森林" })).features)).toEqual([
      "osm:node:3",
      "osm:way:10",
    ]);
  });

  it("uses a place name as the origin and applies the default walking radius", async () => {
    const { byName } = mapReady();
    const out = await call(byName.find_features, { near: "Daan Station", categories: ["supermarket"] });
    // The other PX Mart is ~3 km away, so the 800 m default must exclude it.
    expect(idsOf(out.features)).toEqual(["osm:node:30"]);
    expect(out.features?.[0].distance_m).toBeLessThan(DEFAULT_RADIUS_M);
  });

  it("widens the search when radius_m is given explicitly", async () => {
    const { byName } = mapReady();
    const out = await call(byName.find_features, {
      near: "Daan Station",
      categories: ["supermarket"],
      radius_m: 5000,
    });
    expect(idsOf(out.features)).toEqual(["osm:node:30", "osm:node:32"]);
  });

  it("accepts a feature id or a raw coordinate as the origin", async () => {
    const { byName } = mapReady();
    const byId = await call(byName.find_features, { near: "osm:node:2", categories: ["supermarket"] });
    const byCoord = await call(byName.find_features, {
      near: { lng: 121.5436, lat: 25.0334 },
      categories: ["supermarket"],
    });
    expect(byId).toEqual(byCoord);
  });

  it("asks instead of guessing when the origin place is ambiguous", async () => {
    const { byName } = mapReady();
    const out = await call(byName.find_features, { near: "PX Mart" });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates).toHaveLength(2);
  });

  it("reports an unknown or malformed origin", async () => {
    const { byName } = mapReady();
    expect((await call(byName.find_features, { near: "Shibuya" })).error).toBe("unknown place");
    expect((await call(byName.find_features, { near: { lng: 999, lat: 0 } })).error).toMatch(/lng/);
    expect((await call(byName.find_features, { near: 42 })).error).toMatch(/near must be/);
  });

  it("defaults to 20 results and refuses a limit it cannot honour", async () => {
    const { byName } = mapReady();
    expect(DEFAULT_LIMIT).toBe(20);
    const out = await call(byName.find_features, {});
    expect(out.total).toBe(FIXTURE_FEATURES.length);
    expect(out.returned).toBe(Math.min(DEFAULT_LIMIT, FIXTURE_FEATURES.length));
    expect((await call(byName.find_features, { limit: 0 })).error).toMatch(/limit/);
    expect((await call(byName.find_features, { limit: 2.5 })).error).toMatch(/limit/);
  });

  it("returns an empty result rather than an error when nothing matches", async () => {
    const { byName } = mapReady();
    const out = await call(byName.find_features, { query: "Shibuya" });
    expect(out).toEqual({ total: 0, returned: 0, features: [] });
  });

  it("says 'within' is not implemented yet instead of silently ignoring it", async () => {
    // The parameter is reserved so an agent that reads the schema in D3 does not
    // have to re-learn the tool; until then a passed value must not be dropped.
    const { byName } = mapReady();
    expect(await call(byName.find_features, { within: "shape:1" })).toEqual({
      error: "within is not available yet",
    });
  });

  it("has the same result shape as list_features_in_view", async () => {
    const { byName } = mapReady();
    const a = await call(byName.find_features, { limit: 3 });
    const b = await call(byName.list_features_in_view, { limit: 3 });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});
