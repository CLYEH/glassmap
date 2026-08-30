import { describe, expect, it } from "vitest";
import { createMapTools, PLACE_ZOOM, validateSetMapView } from "./index";
import { createMemoryToolStore, DEFAULT_VIEW, type MemoryToolStore } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { distanceMeters, featureCenter, type FeatureOutput } from "./output";
import type { MapStateOutput } from "./state";
import { DEFAULT_LIMIT, DEFAULT_RADIUS_M, MAX_QUERY_RADIUS_M } from "./query";
import {
  BROKEN_FEATURES,
  DAAN_FOREST_PARK,
  FIXTURE_FEATURES,
  IN_VIEW_IDS_BY_DISTANCE,
  PX_MART_DAAN,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

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
  candidates?: { id: string; name: string; name_en?: string; category: string; distance_m?: number }[];
  total?: number;
  returned?: number;
  features?: FeatureOutput[];
  selected?: FeatureOutput[];
  unknown_ids?: string[];
  unknown_count?: number;
  known_ids?: string[];
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
    expect(byName.describe_surroundings.annotations?.readOnlyHint).toBe(true);
    expect(byName.compare_areas.annotations?.readOnlyHint).toBe(true);
    expect(byName.measure.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_share_link.annotations?.readOnlyHint).toBe(true);
    expect(byName.set_map_view.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.select_features.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.draw_shape.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.annotate.annotations?.readOnlyHint).toBeFalsy();
  });

  it("marks untrustedContentHint on every tool that can echo OSM or user text", () => {
    // Names come from OpenStreetMap and from sample listings; a client must be
    // able to treat them as data, not as instructions.
    const { byName } = toolsFor();
    // Since drawings and annotations landed, *every* tool that answers about
    // the map echoes third-party text: map state carries the labels and notes
    // a human typed on the page, and those tools all return map state.
    // get_share_link is the one exception, and it has to be an explicit one:
    // its whole output is a URL built here out of base64, so marking it
    // untrusted would train clients to distrust a link they can safely open.
    const ECHOES_NOTHING = ["get_share_link"];
    for (const t of toolsFor().tools) {
      if (ECHOES_NOTHING.includes(t.name)) {
        expect(t.annotations?.untrustedContentHint, t.name).toBeFalsy();
        continue;
      }
      expect(t.annotations?.untrustedContentHint, t.name).toBe(true);
    }
    expect(byName.get_map_state.annotations?.readOnlyHint).toBe(true);
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

  /**
   * A tool that throws takes the whole agent turn down, and one that silently
   * accepts nonsense is worse: the human sees the map do the wrong thing. Every
   * row states which tools must refuse the input; all of them must leave the
   * view and the selection exactly as they were.
   */
  const HOSTILE: { input: unknown; rejectedBy: string[] }[] = [
    { input: { zoom: "banana" }, rejectedBy: ["set_map_view"] },
    { input: { zoom: 99 }, rejectedBy: ["set_map_view"] },
    { input: { bearing: Infinity }, rejectedBy: ["set_map_view"] },
    { input: { center: null }, rejectedBy: ["set_map_view"] },
    { input: { place: "😀" }, rejectedBy: ["set_map_view"] },
    { input: { near: {} }, rejectedBy: ["find_features", "select_features"] },
    { input: { near: true }, rejectedBy: ["find_features", "select_features"] },
    {
      input: { categories: "park" },
      rejectedBy: ["list_features_in_view", "find_features", "select_features", "compare_areas"],
    },
    { input: { limit: -1 }, rejectedBy: ["list_features_in_view", "find_features"] },
    { input: { ids: 7 }, rejectedBy: ["select_features"] },
    { input: { ids: [null] }, rejectedBy: ["select_features"] },
    { input: { ids: Array.from({ length: 101 }, (_, i) => `x:${i}`) }, rejectedBy: ["select_features"] },
    {
      input: {},
      rejectedBy: [
        "set_map_view",
        "select_features",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
      ],
    },
    // Not an object at all — some clients pass the raw argument through.
    {
      input: "hello",
      rejectedBy: [
        "set_map_view",
        "select_features",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
      ],
    },
    {
      input: null,
      rejectedBy: [
        "set_map_view",
        "select_features",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
      ],
    },
    { input: { type: "blob", coordinates: [] }, rejectedBy: ["draw_shape"] },
    { input: { type: "circle" }, rejectedBy: ["draw_shape"] },
    { input: { type: "circle", center: "Daan Station", radius_m: 0 }, rejectedBy: ["draw_shape"] },
    {
      input: { type: "circle", center: "Daan Station", radius_m: -5 },
      rejectedBy: [
        "draw_shape",
        "find_features",
        "select_features",
        "describe_surroundings",
        "compare_areas",
      ],
    },
    // A shape the UI has to redraw on every frame: 501 points is refused, so
    // one call cannot make the map unusable for the human.
    {
      input: {
        type: "line",
        coordinates: Array.from({ length: 501 }, (_, i) => [121.5 + i / 100000, 25]),
      },
      rejectedBy: ["draw_shape"],
    },
    // One radius story: every tool that takes radius_m refuses the same values.
    {
      input: { radius_m: 500000 },
      rejectedBy: ["find_features", "select_features", "describe_surroundings", "compare_areas"],
    },
    {
      input: { type: "polygon", coordinates: [[121.5, 25], [121.6, 25]] },
      rejectedBy: ["draw_shape"],
    },
    { input: { type: "line", coordinates: [[121.5, 25]] }, rejectedBy: ["draw_shape"] },
    {
      input: { type: "line", coordinates: [[121.5, 25], [181, 25]] },
      rejectedBy: ["draw_shape"],
    },
    { input: { at: { lng: 121.5, lat: 25 }, note: "   " }, rejectedBy: ["annotate"] },
    { input: { at: { lng: 121.5, lat: 25 }, note: "x".repeat(501) }, rejectedBy: ["annotate"] },
    { input: { at: "Shibuya", note: "hi" }, rejectedBy: ["annotate"] },
    { input: { at: 42, note: "hi" }, rejectedBy: ["annotate"] },
    { input: { note: "no location" }, rejectedBy: ["annotate"] },
    { input: { within: "drawing:404" }, rejectedBy: ["find_features", "select_features"] },
    { input: { within: 7 }, rejectedBy: ["find_features", "select_features"] },
    {
      input: { radius_m: "500" },
      rejectedBy: ["find_features", "select_features", "describe_surroundings", "compare_areas"],
    },
    { input: { from: "Shibuya" }, rejectedBy: ["describe_surroundings"] },
    // A comparison is between two places: one side plus the view centre would
    // be a confident answer to a question nobody asked.
    { input: { a: "Daan Station" }, rejectedBy: ["compare_areas"] },
    { input: { b: { lng: 121.5, lat: 25 } }, rejectedBy: ["compare_areas"] },
    { input: { a: "Pxmart", b: "Daan Station" }, rejectedBy: ["compare_areas"] },
    { input: { a: "Daan Station", b: "Shibuya" }, rejectedBy: ["compare_areas"] },
    { input: { a: { lng: 999, lat: 0 }, b: "Daan Station" }, rejectedBy: ["compare_areas"] },
    { input: { target: 7 }, rejectedBy: ["measure"] },
    { input: { target: "drawing:404" }, rejectedBy: ["measure"] },
    // A station is a point: measuring it must fail loudly rather than come back
    // as an area of zero, which reads as "a place with no size".
    { input: { target: "osm:node:2" }, rejectedBy: ["measure"] },
  ];

  it.each(HOSTILE)("refuses $input without throwing or changing state", async ({ input, rejectedBy }) => {
    for (const t of toolsFor().tools) {
      const { store, byName } = mapReady({ selection: ["osm:node:2"] });
      const out = (await byName[t.name].execute(input as never, { signal })) as ToolResult;
      expect(typeof out, t.name).toBe("object");
      if (rejectedBy.includes(t.name)) {
        expect(out, `${t.name} must reject`).toHaveProperty("error");
        expect(typeof out.error, t.name).toBe("string");
      }
      expect(store.getView(), `${t.name} moved the map`).toEqual(VIEW);
      expect(store.getSelection(), `${t.name} changed the selection`).toEqual(["osm:node:2"]);
      // Nothing in this table describes a shape or a note, so nothing may be
      // drawn on the human's map either.
      expect(store.getDrawings(), `${t.name} drew something`).toEqual([]);
      expect(store.getAnnotations(), `${t.name} pinned something`).toEqual([]);
    }
  });

  it("degrades instead of throwing when a feature has unusable geometry", async () => {
    // The loader can hand us a relation that failed to assemble; one bad
    // feature must not take down every query over the other 2000.
    const { store, byName } = mapReady({ features: [...FIXTURE_FEATURES, ...BROKEN_FEATURES] });
    for (const input of [{}, { query: "polygon" }, { near: "Daan", radius_m: 5000 }]) {
      for (const name of ["list_features_in_view", "find_features"]) {
        const out = await call(byName[name], input);
        expect(out.error, `${name} ${JSON.stringify(input)}`).toBeUndefined();
      }
    }
    // A broken feature can still be selected by id; it just has no distance.
    const out = await call(byName.select_features, { ids: ["broken:empty-polygon"] });
    expect(out.unknown_ids).toEqual([]);
    expect(out.selected?.[0]).toMatchObject({ id: "broken:empty-polygon" });
    expect(out.selected?.[0].distance_m).toBeUndefined();
    expect(store.getSelection()).toEqual(["broken:empty-polygon"]);
    // ...and it is never offered as a place, because it has no location.
    expect((await call(byName.set_map_view, { place: "Empty polygon" })).error).toBe("unknown place");
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
      drawings: { count: 0, items: [] },
      annotations: { count: 0, items: [] },
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
    const out = await call(byName.set_map_view, { place: "Pxmart" });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    // The map must be exactly where it was: a wrong jump is invisible to the agent.
    expect(store.getView()).toEqual(before);
  });

  it("offers the five nearest candidates, measured from where the human is looking", async () => {
    // 208 branches share this name in the real data. Five identical rows would
    // be useless, and the far ones are useless too — so cap, and sort by
    // distance from the current view centre.
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...PX_MART_DAAN,
      properties: { ...PX_MART_DAAN.properties, id: `osm:node:9${i}` },
      geometry: { type: "Point" as const, coordinates: [121.5375 + 0.01 * (8 - i), 25.0325] },
    }));
    const { byName } = mapReady({ features: many });
    const out = await call(byName.set_map_view, { place: "Pxmart" });
    expect(out.candidates).toHaveLength(5);
    // Feature 7 is the closest, 3 the fifth closest; 0..2 are dropped.
    expect(out.candidates?.map((c) => c.id)).toEqual([
      "osm:node:97",
      "osm:node:96",
      "osm:node:95",
      "osm:node:94",
      "osm:node:93",
    ]);
    const distances = out.candidates?.map((c) => c.distance_m ?? 0) ?? [];
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeGreaterThan(0);
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

  it("echoes the view centre its distances were measured from", async () => {
    // The same reason find_features echoes its origin: "220 m NE" is unusable
    // without the point it is from, and the view can move between two calls.
    // It also keeps this tool's answer shape equal to find_features's, which
    // is what lets an agent treat the two results as one kind of thing.
    const { byName, store } = mapReady();
    expect((await call(byName.list_features_in_view)).origin).toEqual({
      lng: VIEW.center[0],
      lat: VIEW.center[1],
    });
    store.setView({ center: [121.51, 25.05] });
    expect((await call(byName.list_features_in_view)).origin).toEqual({ lng: 121.51, lat: 25.05 });
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
    // "cafeteria" is the test's whole point: it is not one of the six bundled
    // categories *and* not one of the 18 point-of-interest ones, so the
    // rejection is about the name, not about a file that failed to load.
    const { byName } = mapReady();
    expect(
      (await call(byName.list_features_in_view, { categories: ["cafeteria"] })).error,
    ).toMatch(/cafeteria/);
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
    expect(out.features?.[0]).toMatchObject({ id: "listing:01", direction: "SW", sample: true });
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

  it("refuses a radius past the shared cap rather than searching a narrower one", async () => {
    // find_features, select_features, draw_shape and describe_surroundings all
    // stop at the same number, so an agent learns one rule. Quietly narrowing
    // the search would answer "there is no supermarket" about a shop it never
    // looked for.
    const { store, byName } = mapReady({ selection: ["osm:node:2"] });
    for (const name of ["find_features", "select_features"]) {
      const out = await call(byName[name], { near: "Daan Station", radius_m: MAX_QUERY_RADIUS_M + 1 });
      expect(out.error, name).toMatch(String(MAX_QUERY_RADIUS_M));
    }
    expect(store.getSelection()).toEqual(["osm:node:2"]);
    expect(MAX_QUERY_RADIUS_M).toBe(10000);
    // Exactly at the cap still works.
    expect((await call(byName.find_features, { radius_m: MAX_QUERY_RADIUS_M })).error).toBeUndefined();
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
    const out = await call(byName.find_features, { near: "Pxmart" });
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
    // Still exhaustive on purpose: this assertion is the tool layer's guard
    // against result-shape drift. The origin is part of the empty answer by
    // design — "nothing within reach of here" is a different fact from
    // "nothing anywhere", and only the echo says which one this is. No
    // radius_m: this query bounded nothing, so claiming one would be a lie.
    const { byName } = mapReady();
    const out = await call(byName.find_features, { query: "Shibuya" });
    expect(out).toEqual({
      total: 0,
      returned: 0,
      features: [],
      origin: { lng: VIEW.center[0], lat: VIEW.center[1] },
    });
  });

  it("echoes the origin it measured from, so a name or an id resolves visibly", async () => {
    // Every distance_m and direction in the answer is measured from a point
    // the caller may never have stated: "near Daan Station" is a name, not a
    // coordinate. Without the echo the result cannot be checked, replayed or
    // drawn — the page would have to guess which point the agent searched
    // around, and guessing is the one thing this tool layer does not do.
    const { byName } = mapReady();
    const named = await call(byName.find_features, {
      near: "Daan Station",
      categories: ["supermarket"],
    });
    expect(named.origin).toEqual({ lng: 121.5436, lat: 25.0334 });
    // The by-id and by-coordinate forms of the same origin stay identical
    // answers: the echo is the resolved point, never the input's spelling.
    const byId = await call(byName.find_features, { near: "osm:node:2", categories: ["supermarket"] });
    expect(byId).toEqual(named);
  });

  it("echoes radius_m only when the search really was bounded by one", async () => {
    // A radius on an unbounded search would claim a limit that was never
    // applied — the agent would report "nothing within 800 m" about a query
    // that searched the whole city, and the page would draw a ring around a
    // sweep that had none.
    const { byName } = mapReady();
    const bounded = await call(byName.find_features, { near: "Daan Station" });
    expect(bounded.radius_m).toBe(DEFAULT_RADIUS_M);
    expect((await call(byName.find_features, { radius_m: 250 })).radius_m).toBe(250);
    const unbounded = await call(byName.find_features, { query: "Pxmart" });
    expect(unbounded).not.toHaveProperty("radius_m");
    expect(unbounded.origin).toEqual({ lng: VIEW.center[0], lat: VIEW.center[1] });
  });

  it("rounds the echoed origin like every other coordinate it prints", async () => {
    // Output discipline is a contract, not a preference: five decimals is
    // about a metre, and a raw double here would be the one place in the tool
    // layer where an agent pays for eleven.
    const { byName } = mapReady();
    const out = await call(byName.find_features, { near: { lng: 121.123456789, lat: 25.987654321 } });
    expect(out.origin).toEqual({ lng: 121.12346, lat: 25.98765 });
  });

  it("measures from the origin it prints, so every distance can be recomputed", async () => {
    // Rounding on the way out alone would print a point up to a metre from the
    // one the distances were taken from, and both search tools would look
    // right while disagreeing: an agent replaying "220 m NE" from the origin it
    // was handed would get a different number, with nothing in the answer to
    // say which of the two was the map's. Rounding before measuring makes the
    // echo checkable, which is the only reason it is worth its tokens.
    const { byName, store } = mapReady();
    const centre = { lng: 121.5375024, lat: 25.0325044 };
    store.setView({ center: [centre.lng, centre.lat] });
    const unreplayable = (out: ToolResult) => {
      const { lng, lat } = out.origin as { lng: number; lat: number };
      return (out.features ?? [])
        .filter((f) => {
          const feature = FIXTURE_FEATURES.find((x) => x.properties.id === f.id)!;
          return distanceMeters([lng, lat], featureCenter(feature)!) !== f.distance_m;
        })
        .map((f) => f.id);
    };
    const listed = await call(byName.list_features_in_view);
    expect(listed.features?.length).toBe(IN_VIEW_IDS_BY_DISTANCE.length);
    expect(unreplayable(listed)).toEqual([]);
    const found = await call(byName.find_features, { near: centre });
    expect(found.features?.length).toBeGreaterThan(0);
    expect(unreplayable(found)).toEqual([]);
  });

  it("refuses an unknown shape id instead of ignoring the filter", async () => {
    // Dropping an unresolvable spatial filter is the worst possible failure:
    // "the shops inside the circle I drew" would answer with the whole city.
    const { byName } = mapReady();
    const out = await call(byName.find_features, { within: "shape:1" });
    expect(out.error).toMatch(/drawing/);
    expect(out.features).toBeUndefined();
  });

  it("has the same result shape as list_features_in_view", async () => {
    // Parity is a promise to the agent: whatever it learned to read from one
    // search tool it can read from the other. That is why the origin echo was
    // added to both at once — a field on find alone would have made "the same
    // kind of answer" false, and this test is what says so.
    const { byName } = mapReady();
    const a = await call(byName.find_features, { limit: 3 });
    const b = await call(byName.list_features_in_view, { limit: 3 });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a)).toContain("origin");
  });
});

describe("select_features", () => {
  it("stores the ids the UI highlights and returns the new state", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.select_features, { ids: ["osm:way:10", "osm:node:2"] });
    expect(store.getSelection()).toEqual(["osm:way:10", "osm:node:2"]);
    expect(idsOf(out.selected)).toEqual(["osm:way:10", "osm:node:2"]);
    expect(out.state).toMatchObject({ selection: { count: 2, ids: ["osm:way:10", "osm:node:2"] } });
    // The state it returns is the state get_map_state would have returned.
    expect(Object.keys(out.state ?? {}).sort()).toEqual(
      Object.keys(await call(byName.get_map_state)).sort(),
    );
  });

  it("reports ids it could not resolve while still selecting the rest", async () => {
    // Half-working beats failing: the agent learns which id was stale and the
    // human still sees the features that do exist.
    const { store, byName } = mapReady();
    const out = await call(byName.select_features, { ids: ["osm:way:10", "osm:node:404"] });
    expect(out.unknown_ids).toEqual(["osm:node:404"]);
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("replaces by default and adds when replace is false", async () => {
    const { store, byName } = mapReady();
    await call(byName.select_features, { ids: ["osm:way:10"] });
    await call(byName.select_features, { ids: ["osm:node:2"], replace: false });
    expect(store.getSelection()).toEqual(["osm:way:10", "osm:node:2"]);
    await call(byName.select_features, { ids: ["osm:node:1"] });
    expect(store.getSelection()).toEqual(["osm:node:1"]);
  });

  it("never selects the same feature twice", async () => {
    const { store, byName } = mapReady();
    await call(byName.select_features, { ids: ["osm:way:10"] });
    await call(byName.select_features, { ids: ["osm:way:10", "osm:way:10"], replace: false });
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("records the ids it adds as the agent's, and leaves the human's alone", async () => {
    // The map says who selected what, and it only ever says what it was told.
    // This is the agent half of that record; the click toggle is the other.
    // Marking everything the call ends up holding would rewrite the human's
    // own click as the agent's the first time the agent selects around it.
    const { store, byName } = mapReady();
    store.setSelection(["osm:way:10"], "user");
    await call(byName.select_features, { ids: ["osm:node:2"], replace: false });
    expect(store.getSelection()).toEqual(["osm:way:10", "osm:node:2"]);
    expect(store.getSelectionSources()).toEqual({
      "osm:way:10": "user",
      "osm:node:2": "agent",
    });
  });

  it("clears the selection with an empty ids array", async () => {
    const { store, byName } = mapReady({ selection: ["osm:way:10"] });
    const out = await call(byName.select_features, { ids: [] });
    expect(store.getSelection()).toEqual([]);
    expect(out.state).toMatchObject({ selection: { count: 0, ids: [] } });
  });

  it("selects by the same filter as find_features, so both agree on the set", async () => {
    const { store, byName } = mapReady();
    const filter = { near: "Daan Station", categories: ["park"], radius_m: 1500 };
    const found = await call(byName.find_features, filter);
    const selected = await call(byName.select_features, filter);
    expect(idsOf(found.features)).toEqual(["osm:way:10"]);
    expect(store.getSelection()).toEqual(idsOf(found.features));
    expect(idsOf(selected.selected)).toEqual(idsOf(found.features));
    expect(selected.selected?.[0].distance_m).toBe(found.features?.[0].distance_m);
  });

  it("honours query in the filter, exactly as find_features does", async () => {
    /*
     * Regression: select_features used to drop `query` and select everything
     * the rest of the filter matched. Against the real dataset the agent asked
     * for 6 parks and the human saw 8 light up — a silent lie about what "these
     * parks" refers to. Both tools must resolve the same set from one input.
     */
    const { store, byName } = mapReady();
    const filter = { query: "公園", near: "大安", radius_m: 2000, categories: ["park"] };
    const found = await call(byName.find_features, filter);
    const selected = await call(byName.select_features, filter);
    expect(idsOf(found.features)).toEqual(["osm:way:10"]);
    expect(idsOf(selected.selected)).toEqual(idsOf(found.features));
    expect(store.getSelection()).toEqual(idsOf(found.features));

    // Without the query the same filter matches more: proof the query bites.
    const { store: store2, byName: byName2 } = mapReady();
    await call(byName2.select_features, { near: "大安", radius_m: 2000 });
    expect(store2.getSelection().length).toBeGreaterThan(1);
  });

  it("accepts query on its own as a filter, without ids", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.select_features, { query: "Pxmart" });
    expect(out.error).toBeUndefined();
    expect([...store.getSelection()].sort()).toEqual(["osm:node:30", "osm:node:32"]);
  });

  it("selects every match while find_features pages, and says so in state.selection", async () => {
    // The two tools resolve the same set; only the *reporting* is paged. An
    // agent that asked for limit 1 still highlights everything it matched.
    const { store, byName } = mapReady();
    const found = await call(byName.find_features, { categories: ["mrt_station"], limit: 1 });
    const selected = await call(byName.select_features, { categories: ["mrt_station"], limit: 1 });
    expect(found.total).toBe(3);
    expect(found.returned).toBe(1);
    expect(store.getSelection()).toHaveLength(3);
    expect(selected.state?.selection.count).toBe(found.total);
    // The schema description is the only place an agent can learn that the two
    // tools diverge above `limit`; a description that claims they are identical
    // is a lie the agent has no way to detect.
    expect(byName.select_features.description).toMatch(/does not stop at/);
  });

  it("refuses an unknown `within` instead of selecting everything else the filter matched", async () => {
    // Same failure mode as find_features, but visible: the human would watch
    // every park in Taipei light up for "the parks in my circle".
    const { store, byName } = mapReady({ selection: ["osm:node:2"] });
    const out = await call(byName.select_features, { within: "shape:1", categories: ["park"] });
    expect(out.error).toMatch(/drawing/);
    expect(out.known_ids).toEqual([]);
    expect(store.getSelection()).toEqual(["osm:node:2"]);
  });

  it("caps the unknown_ids echo but reports the true count", async () => {
    const { byName } = mapReady();
    const missing = Array.from({ length: 30 }, (_, i) => `osm:node:90${i}`);
    const out = await call(byName.select_features, { ids: missing });
    expect(out.unknown_ids).toHaveLength(20);
    expect(out.unknown_count).toBe(30);
  });

  it("refuses an id list longer than the schema allows", async () => {
    const { store, byName } = mapReady({ selection: ["osm:node:2"] });
    const out = await call(byName.select_features, {
      ids: Array.from({ length: 101 }, (_, i) => `osm:node:${i}`),
    });
    expect(out.error).toMatch(/at most 100/);
    expect(store.getSelection()).toEqual(["osm:node:2"]);
  });

  it("treats an empty match as a valid answer, not an error", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.select_features, { near: "Daan Station", categories: ["school"] });
    expect(out.error).toBeUndefined();
    expect(out.selected).toEqual([]);
    expect(store.getSelection()).toEqual([]);
  });

  it("rejects a call with neither ids nor a filter so nothing happens by accident", async () => {
    const { store, byName } = mapReady({ selection: ["osm:way:10"] });
    const out = await call(byName.select_features, {});
    expect(out.error).toMatch(/provide ids/);
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("does not change the selection when the filter cannot be resolved", async () => {
    const { store, byName } = mapReady({ selection: ["osm:way:10"] });
    const out = await call(byName.select_features, { near: "Pxmart" });
    expect(out.error).toBe("ambiguous place");
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("returns names but no geometry", async () => {
    const { byName } = mapReady();
    const out = await call(byName.select_features, { ids: ["osm:way:10"] });
    expect(out.selected?.[0]).toMatchObject({ name: "大安森林公園", name_en: "Da-an Forest Park" });
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry/);
  });
});

describe("selection ids", () => {
  it("are properties.id, the same string the UI and every other tool uses", async () => {
    // map-ui-dev highlights on this value; find_features returns it; a mismatch
    // would show up as "the agent selected something and nothing lit up".
    const store: MemoryToolStore = createMemoryToolStore({ features: FIXTURE_FEATURES, bounds: VIEW_BOUNDS, view: VIEW });
    const { byName } = toolsFor(store);
    // "Daan Forest" also proves query folding: OSM spells it "Da-an Forest Park".
    const found = await call(byName.find_features, { query: "Daan Forest" });
    const id = found.features?.[0].id;
    expect(id).toBe(DAAN_FOREST_PARK.properties.id);
    await call(byName.select_features, { ids: [id as string] });
    expect(store.getSelection()).toEqual([id]);
  });
});
