import { describe, expect, it } from "vitest";
import { createMapTools, PLACE_ZOOM, validateSetMapView } from "./index";
import { createMemoryToolStore, DEFAULT_VIEW, type MemoryToolStore } from "@/lib/store/map-store";
import { frameFor, geometryBounds, ROW_FIT_MAX_ZOOM } from "@/lib/geo/frame";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { distanceMeters, featureCenter, type FeatureOutput } from "./output";
import { round5, type MapStateOutput } from "./state";
import { DEFAULT_LIMIT, DEFAULT_RADIUS_M, MAX_QUERY_RADIUS_M } from "./query";
import {
  BROKEN_FEATURES,
  DAAN_FOREST_PARK,
  FIXTURE_FEATURES,
  IN_VIEW_IDS_BY_DISTANCE,
  PX_MART_DAAN,
  USER_DRAWN_AREA,
  USER_DRAWN_LINE,
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
    expect(byName.get_place_details.annotations?.readOnlyHint).toBe(true);
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
    // One name filter, one refusal: every tool that takes `query` turns down the
    // same value, so an agent cannot learn that a number is acceptable anywhere.
    {
      input: { query: 42 },
      rejectedBy: ["list_features_in_view", "find_features", "select_features"],
    },
    { input: { ids: 7 }, rejectedBy: ["select_features", "remove_from_map"] },
    { input: { ids: [null] }, rejectedBy: ["select_features", "remove_from_map"] },
    {
      input: { ids: Array.from({ length: 101 }, (_, i) => `x:${i}`) },
      rejectedBy: ["select_features", "remove_from_map"],
    },
    {
      input: {},
      rejectedBy: [
        "set_map_view",
        "select_features",
        "remove_from_map",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
        "get_place_details",
      ],
    },
    // Not an object at all — some clients pass the raw argument through.
    {
      input: "hello",
      rejectedBy: [
        "set_map_view",
        "select_features",
        "remove_from_map",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
        "get_place_details",
      ],
    },
    {
      input: null,
      rejectedBy: [
        "set_map_view",
        "select_features",
        "remove_from_map",
        "draw_shape",
        "annotate",
        "compare_areas",
        "measure",
        "get_place_details",
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

  it("says bounds follows the chrome actually on screen, in both directions", () => {
    // The page opens without its agent chrome and grows the inspector lane the
    // moment an agent acts (`components/MapCanvas.tsx`, `inspectorLane()`) -
    // and since T-93 the human can also open or close that chrome by hand at
    // any time. So bounds can widen as well as narrow between two calls, and
    // an agent that is not told will read either jump as the human having
    // moved the map. The description is the only place it can learn otherwise;
    // the old promise ("every call after the first reports the narrowed one")
    // became false the day the toggle shipped.
    expect(toolsFor().byName.get_map_state.description).toMatch(
      /open or close that chrome by hand/,
    );
    expect(toolsFor().byName.get_map_state.description).toMatch(
      /bounds always describes the rectangle actually on screen/,
    );
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
    // The fixture camera is at zoom 14, below the floor, so the default lands.
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { place: "Daan Station" });
    expect(store.getView().center).toEqual([121.5436, 25.0334]);
    expect(out).toMatchObject({ center: { lng: 121.5436, lat: 25.0334 }, zoom: PLACE_ZOOM });
  });

  /**
   * Going somewhere by name never pulls the camera back (T-102 qa finding).
   *
   * `PLACE_ZOOM` is a floor, not a reset, and it has to be: a person looking at
   * one building keeps that scale when the agent flies to the shop next door,
   * exactly as they do when they click an inspector row, pick a search result,
   * or when the agent uses `fit` on the same feature. Until this ruling
   * `feature_id`/`place` were the one path that silently zoomed out — same
   * camera, same target, a different answer depending on which parameter named
   * it, while the schema promised `fit` on a point "behaves exactly like
   * feature_id". The zoom an agent actually wants is one it can always state.
   */
  const deepView = { ...VIEW, zoom: 18 };

  it("keeps a closer view when it flies to a place or an id, instead of resetting to 15", async () => {
    const byPlace = mapReady({ view: deepView });
    const byId = mapReady({ view: deepView });

    const place = await call(byPlace.byName.set_map_view, { place: "Daan Station" });
    const id = await call(byId.byName.set_map_view, { feature_id: "osm:node:2" });

    expect(byPlace.store.getView().zoom).toBe(18);
    expect(byId.store.getView().zoom).toBe(18);
    // Both moved: the camera went to the station and stayed at street scale.
    expect(place).toMatchObject({ center: { lng: 121.5436, lat: 25.0334 }, zoom: 18 });
    expect(id).toMatchObject({ center: { lng: 121.5436, lat: 25.0334 }, zoom: 18 });
  });

  it("still climbs to 15 from further out, so a city-wide view lands on the place", async () => {
    // The other side of a floor: from zoom 10 the station is a dot in a city,
    // and arriving without zooming in would answer "go there" with nothing.
    const { store, byName } = mapReady({ view: { ...VIEW, zoom: 10 } });
    await call(byName.set_map_view, { feature_id: "osm:node:2" });
    expect(store.getView().zoom).toBe(PLACE_ZOOM);
  });

  it("lets an explicit zoom win in either direction, including out", async () => {
    // The floor is a default, not a policy: an agent that means 12 says 12,
    // from anywhere. Without this the ruling would take away the only way to
    // pull back while naming a place.
    const { store, byName } = mapReady();
    await call(byName.set_map_view, { place: "Daan Station", zoom: 18 });
    expect(store.getView().zoom).toBe(18);

    const deep = mapReady({ view: deepView });
    await call(deep.byName.set_map_view, { place: "Daan Station", zoom: 12 });
    expect(deep.store.getView().zoom).toBe(12);

    const deepById = mapReady({ view: deepView });
    await call(deepById.byName.set_map_view, { feature_id: "osm:node:2", zoom: 12 });
    expect(deepById.store.getView().zoom).toBe(12);
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

/**
 * `fit` — the second half of T-102's reverse parity.
 *
 * A human clicking a row in the inspector gets the thing framed: the whole
 * district, the whole drawn circle, all of it on screen (T-101). An agent
 * could only ever say "go to this coordinate at this zoom", which for anything
 * with an extent is a guess — and a wrong guess is invisible to it. `fit` is
 * the same camera the row click asks for, from the same function
 * (`lib/geo/frame`), so the two paths cannot frame the same thing differently.
 */
describe("set_map_view fit", () => {
  /** The fixture map with two hand-drawn marks on it: an area and a line. */
  const drawn = () => mapReady({ drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE] });

  it("frames a drawing exactly as the human's own row click would", async () => {
    // The parity claim, checked against the shared function rather than a
    // number: what the tool writes is what `frameFor` returns for the same
    // extent, the same camera and the same visible rectangle. A tool that
    // re-derived the maths could pass a "did it zoom in?" test and still
    // disagree with the human path by half a level.
    const { store, byName } = drawn();
    const expected = frameFor(geometryBounds(USER_DRAWN_AREA.geometry)!, VIEW, VIEW_BOUNDS);

    const out = await call(byName.set_map_view, { fit: "drawing:1" });

    expect(out.error).toBeUndefined();
    expect(store.getView().center).toEqual(expected.center);
    expect(store.getView().zoom).toBe(expected.zoom);
    // Independently of the shared function: the polygon is a fraction of the
    // viewport, so framing it has to move closer, and never past the cap that
    // keeps a street readable.
    expect(expected.zoom).toBeGreaterThan(VIEW.zoom);
    expect(expected.zoom).toBeLessThanOrEqual(ROW_FIT_MAX_ZOOM);
    // The answer is the new state, so nothing has to be read back.
    expect(out).toMatchObject({ zoom: round5(expected.zoom) });
  });

  it("zooms OUT for something bigger than the view, which is what framing means", async () => {
    // The rule that separates `fit` from every other way to move this camera:
    // 大安區 is wider than the fixture viewport, so the only way to show it is
    // to pull back. A "fit" that refused to widen would answer "show me the
    // district" with one of its street corners - and the agent, which cannot
    // see the screen, would believe it.
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { fit: "district:daan" });

    expect(out.error).toBeUndefined();
    // The middle of the district's box, not the middle of the old view. Read
    // off the answer, which is where the agent reads it: the store keeps the
    // midpoint as computed - the same value the human's row click writes - and
    // map state is the one place it is rounded.
    expect(out).toMatchObject({ center: { lng: 121.544, lat: 25.029 } });
    expect(store.getView().zoom).toBeLessThan(VIEW.zoom);
  });

  it("treats a point exactly as feature_id does, from BOTH sides of the floor", async () => {
    // A place with no extent has no fit; the honest answer is the one this
    // tool already gives for an id - fly there, never zoom out - and the
    // description says the two are the same call. Two stores per starting
    // camera, one comparison, so the promise is pinned by behaviour rather
    // than by two constants that happen to both read 15 today.
    //
    // Both regimes, because only one of them used to work. qa found this while
    // writing the e2e parity test: from zoom 14 the two agreed, and from 18
    // `fit` held the floor (18) while `feature_id` reset to 15 - the schema's
    // "exactly like feature_id" was true only below the floor. Testing one
    // start is what let that ship; testing both is what keeps it fixed.
    for (const [label, start] of [
      ["below the floor", 14],
      ["above the floor", 18],
    ] as const) {
      const view = { ...VIEW, zoom: start };
      const viaFit = mapReady({ view });
      const viaId = mapReady({ view });
      const fitted = await call(viaFit.byName.set_map_view, { fit: "osm:node:2" });
      const flown = await call(viaId.byName.set_map_view, { feature_id: "osm:node:2" });

      expect(fitted.error, label).toBeUndefined();
      expect(viaFit.store.getView(), label).toEqual(viaId.store.getView());
      // Byte-equal answers, not merely equal cameras: the two calls are one
      // rule, so an agent can swap them without reading the difference.
      expect(fitted, label).toEqual(flown);
      expect(viaFit.store.getView().zoom, label).toBe(Math.max(start, PLACE_ZOOM));
    }
  });

  it("answers an unknown drawing id with the ids that do exist", async () => {
    // The same answer `within` and `measure` give, for the same reason: an id
    // the tool cannot resolve must never become a camera move to somewhere
    // plausible, and the agent needs the vocabulary to correct itself in one
    // step rather than by guessing.
    const { store, byName } = drawn();
    const out = await call(byName.set_map_view, { fit: "drawing:9" });

    expect(out.error).toBe("unknown drawing id: drawing:9");
    expect(out.known_ids).toEqual(["drawing:1", "drawing:2"]);
    expect(store.getView()).toEqual(VIEW);
  });

  it("answers an unknown feature id with the words this tool already uses", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.set_map_view, { fit: "osm:node:404" });

    expect(out.error).toBe("unknown feature_id");
    expect(store.getView()).toEqual(VIEW);
  });

  it("names both vocabularies when fit is not an id at all", async () => {
    const { store, byName } = mapReady();
    for (const bad of [42, "", "   ", null]) {
      const out = await call(byName.set_map_view, { fit: bad });
      expect(out.error, String(bad)).toMatch(/fit must be a drawing id .* or the id of a loaded/);
    }
    expect(store.getView()).toEqual(VIEW);
  });

  it("refuses a fit combined with another target, or with a zoom", async () => {
    // Two contradictions, and neither may be resolved by preference. A fit
    // beside a center is two cameras; a fit beside a zoom is a frame the
    // caller has overruled without being told. Both come back with the map
    // where it was, in the same voice as the tool's existing either/or.
    const { store, byName } = drawn();
    const withCenter = await call(byName.set_map_view, {
      fit: "drawing:1",
      center: { lng: 121.5, lat: 25 },
    });
    const withPlace = await call(byName.set_map_view, { fit: "drawing:1", place: "Daan Station" });
    const withZoom = await call(byName.set_map_view, { fit: "drawing:1", zoom: 18 });

    expect(withCenter.error).toMatch(/either fit or center\/place\/feature_id/);
    expect(withPlace.error).toMatch(/either fit or center\/place\/feature_id/);
    expect(withZoom.error).toMatch(/either fit or zoom/);
    expect(store.getView()).toEqual(VIEW);
  });

  it("says the map is not ready rather than framing against a rectangle it does not have", async () => {
    // A fit is measured against what the human can see. Before the map has
    // reported a viewport there is no such rectangle, and `frameFor` would
    // quietly fall back to the point rule - which an agent would read as
    // "framed" over a district it is standing in the middle of. The refusal is
    // the one list_features_in_view already gives for the same missing fact.
    const { store, byName } = mapReady({ bounds: null, drawings: [USER_DRAWN_AREA] });
    const out = await call(byName.set_map_view, { fit: "drawing:1" });

    expect(out.error).toBe("map not ready");
    expect(store.getView()).toEqual(VIEW);
  });

  it("still moves the camera's bearing and pitch while it frames", async () => {
    // fit decides where the camera is and how close; it says nothing about
    // which way it faces. Refusing those two as well would make "frame this,
    // north-up" two calls with a flicker between them.
    const { store, byName } = drawn();
    const out = await call(byName.set_map_view, { fit: "drawing:2", bearing: 90, pitch: 30 });

    expect(out.error).toBeUndefined();
    expect(store.getView().bearing).toBe(90);
    expect(store.getView().pitch).toBe(30);
    // drawing:2 is a line - it has an extent, so it is framed like any area.
    expect(store.getView().center).toEqual([121.535, 25.03]);
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

  it("searches by name inside the view, which neither tool could do alone", async () => {
    // The gap this parameter closes: "the Pxmart I can see" was two tools and
    // no way to combine them — find_features knows the name but not the
    // screen, and this tool knew the screen but not the name. Both PX Marts
    // share a name; only one is in view, and the answer must be that one.
    const { byName } = mapReady();
    const inView = await call(byName.list_features_in_view, { query: "Pxmart" });
    expect(idsOf(inView.features)).toEqual(["osm:node:30"]);
    expect(inView.total).toBe(1);
    // The same words asked of the whole city still find both, so the narrowing
    // is the view and nothing else.
    const everywhere = await call(byName.find_features, { query: "Pxmart" });
    expect(idsOf(everywhere.features).sort()).toEqual(["osm:node:30", "osm:node:32"]);
  });

  it("matches the English name, folded exactly as find_features folds it", async () => {
    // OSM writes "Da-an Forest Park" and people type "Daan forest"; the park's
    // local name has no Latin letters at all, so this can only pass through the
    // English name and the shared punctuation folding. Two tools, one rule: a
    // spelling that finds a place city-wide finds it on screen too.
    const { byName } = mapReady();
    const listed = await call(byName.list_features_in_view, { query: "daan forest" });
    expect(idsOf(listed.features)).toEqual(["osm:way:10"]);
    expect(idsOf((await call(byName.find_features, { query: "daan forest" })).features)).toEqual([
      "osm:way:10",
    ]);
  });

  it("combines query with categories instead of replacing either", async () => {
    // Both filters, both applied: 大安 in view is two stations, a park and a
    // district, and asking for stations must drop the other two rather than
    // widening back to every station on screen. A tool that let one filter win
    // would answer a question the agent did not ask, and the ids look
    // plausible either way.
    const { byName } = mapReady();
    const both = await call(byName.list_features_in_view, {
      query: "大安",
      categories: ["mrt_station"],
    });
    expect(idsOf(both.features)).toEqual(["osm:node:3", "osm:node:2"]);

    const nameOnly = await call(byName.list_features_in_view, { query: "大安" });
    expect(idsOf(nameOnly.features)).toEqual([
      "osm:node:3",
      "osm:way:10",
      "osm:node:2",
      "district:daan",
    ]);
    const categoryOnly = await call(byName.list_features_in_view, { categories: ["mrt_station"] });
    expect(idsOf(categoryOnly.features)).toEqual(["osm:node:3", "osm:node:2"]);
    // ...and each of them is a strictly wider set than the two together.
    expect(both.total).toBeLessThan(nameOnly.total!);
  });

  it("answers an honest zero, still saying where it looked", async () => {
    // "Nothing on this screen matches" is a fact about a place, and the origin
    // is what says which place — the same shape find_features returns for an
    // empty search, so an agent reading one can read the other. Exhaustive on
    // purpose: an empty answer must not quietly drop or gain a field.
    const { byName } = mapReady();
    const out = await call(byName.list_features_in_view, { query: "Shibuya" });
    expect(out).toEqual({
      total: 0,
      returned: 0,
      features: [],
      origin: { lng: VIEW.center[0], lat: VIEW.center[1] },
    });
  });

  it("refuses a query that is not a string, in find_features' own words", async () => {
    // One sentence for one mistake: an agent that learns the refusal from one
    // search tool must recognise it from the other, so both come from the same
    // validator rather than from two copies free to drift.
    const { byName } = mapReady();
    const listed = await call(byName.list_features_in_view, { query: 42 });
    expect(listed.error).toBe("query must be a string");
    expect((await call(byName.find_features, { query: 42 })).error).toBe(listed.error);
    // Whitespace is not a filter: it would match every name, and an agent that
    // sent a stray space must not be told the screen is empty.
    expect(idsOf((await call(byName.list_features_in_view, { query: "   " })).features)).toEqual(
      IN_VIEW_IDS_BY_DISTANCE,
    );
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

  it("replace: false adds, so the human's own click keeps its provenance", async () => {
    // The map says who selected what, and it only ever says what it was told.
    // This is the agent half of that record; the click toggle is the other.
    // Marking everything the call ends up holding would rewrite the human's
    // own click as the agent's the first time the agent selects around it -
    // and "3 selected by the agent · 2 by you" would quietly become "5
    // selected by the agent".
    const { store, byName } = mapReady();
    store.setSelection(["osm:way:10"], "user");
    await call(byName.select_features, { ids: ["osm:node:2"], replace: false });
    expect(store.getSelection()).toEqual(["osm:way:10", "osm:node:2"]);
    expect(store.getSelectionSources()).toEqual({
      "osm:way:10": "user",
      "osm:node:2": "agent",
    });
  });

  it("replace: true chooses afresh, so an id the human had clicked becomes the agent's", async () => {
    // The other half of the same rule, and it points the other way. A replace
    // throws the human's selection away and names a new one; every id in the
    // result is one the agent picked, including one the human happened to have
    // picked before. Keeping the old "user" tag would credit a person for a
    // choice the agent made - the direction Ruling 3 calls the harmful one,
    // because it hides the agent's hand rather than over-showing it.
    const { store, byName } = mapReady();
    store.setSelection(["osm:way:10"], "user");
    await call(byName.select_features, { ids: ["osm:way:10", "osm:node:2"] });
    expect(store.getSelection()).toEqual(["osm:way:10", "osm:node:2"]);
    expect(store.getSelectionSources()).toEqual({
      "osm:way:10": "agent",
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
