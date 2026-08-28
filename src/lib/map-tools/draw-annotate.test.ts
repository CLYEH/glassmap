/**
 * draw_shape, annotate and the `within` filter they unlock.
 *
 * The behaviour these tests protect is the demo's whole point: a shape on the
 * map is shared state. Whoever made it — the agent with draw_shape or the human
 * with a mouse — the other one can query it by id, and the numbers they get
 * back (area, length, membership) have to be the real ones.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import {
  createMemoryToolStore,
  type MapToolStore,
  type MemoryToolStoreInit,
} from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { FeatureOutput } from "./output";
import type { MapStateOutput } from "./state";
import { MAX_RADIUS_M, DEFAULT_CIRCLE_RADIUS_M, MAX_LABEL_CHARS, MAX_NOTE_CHARS } from "./shapes";
import {
  FIXTURE_FEATURES,
  USER_DRAWN_AREA,
  USER_DRAWN_LINE,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  candidates?: { id: string }[];
  known_ids?: string[];
  known_count?: number;
  drawing_id?: string;
  annotation_id?: string;
  area_m2?: number;
  length_m?: number;
  features?: FeatureOutput[];
  selected?: FeatureOutput[];
  drawings?: MapStateOutput["drawings"];
  annotations?: MapStateOutput["annotations"];
  state?: MapStateOutput;
}

function mapReady(over: MemoryToolStoreInit = {}) {
  const store: MapToolStore = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    ...over,
  });
  const byName = Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  return { store, byName };
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const idsOf = (features: FeatureOutput[] | undefined) => (features ?? []).map((f) => f.id);

describe("draw_shape circle", () => {
  it("draws a circle round a named place and reports an area a human can sanity-check", async () => {
    // A 64-sided polygon inscribed in the circle loses ~0.16 % of pi*r^2. If
    // this drifts by more than 2 % the units or the steps regressed, and the
    // agent would be quoting an area that does not match the drawn shape.
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "circle",
      center: "Daan Station",
      radius_m: 500,
      label: "5-minute walk",
    });

    expect(out.error).toBeUndefined();
    expect(out.drawing_id).toBe("drawing:1");
    const ideal = Math.PI * 500 * 500;
    expect(out.area_m2).toBeGreaterThan(ideal * 0.98);
    expect(out.area_m2).toBeLessThan(ideal * 1.02);
    expect(Number.isInteger(out.area_m2)).toBe(true);
    expect(out.length_m).toBeUndefined();

    const drawing = store.getDrawings()[0];
    expect(drawing).toMatchObject({
      id: "drawing:1",
      source: "agent",
      kind: "circle",
      label: "5-minute walk",
      center: [121.5436, 25.0334],
      radius_m: 500,
    });
    // The UI renders `geometry`, so a circle must arrive as a closed polygon.
    expect(drawing.geometry.type).toBe("Polygon");
    const ring = (drawing.geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("defaults to a walking radius instead of demanding a number the human never said", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, { type: "circle", center: { lng: 121.5436, lat: 25.0334 } });
    expect(DEFAULT_CIRCLE_RADIUS_M).toBe(800);
    expect(store.getDrawings()[0].radius_m).toBe(DEFAULT_CIRCLE_RADIUS_M);
    expect(out.area_m2).toBeGreaterThan(Math.PI * 800 * 800 * 0.98);
  });

  it("refuses a radius past the cap rather than silently drawing a smaller circle", async () => {
    // Clamping would draw something the human can see and the agent cannot:
    // it would report success for a shape nobody asked for.
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "circle",
      center: { lng: 121.5436, lat: 25.0334 },
      radius_m: MAX_RADIUS_M + 1,
    });
    expect(out.error).toMatch(String(MAX_RADIUS_M));
    expect(store.getDrawings()).toEqual([]);
    expect(out.state).toMatchObject({ drawings: { count: 0, items: [] } });
  });

  it("accepts a feature id as the centre, which is how it circles a search result", async () => {
    const { store, byName } = mapReady();
    await call(byName.draw_shape, { type: "circle", center: "osm:way:10", radius_m: 300 });
    // The park's centroid, not its first vertex.
    expect(store.getDrawings()[0].center).toEqual([121.53575, 25.0295]);
  });

  it("asks instead of guessing when the centre place is ambiguous, and draws nothing", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, { type: "circle", center: "Pxmart", radius_m: 300 });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    expect(store.getDrawings()).toEqual([]);
  });

  it("reports an unknown centre place with the unchanged state", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, { type: "circle", center: "Shibuya" });
    expect(out.error).toBe("unknown place");
    expect(out.state).toBeDefined();
    expect(store.getDrawings()).toEqual([]);
  });

  it("requires a centre, because a circle with no centre is not a shape", async () => {
    const { byName } = mapReady();
    expect((await call(byName.draw_shape, { type: "circle" })).error).toMatch(/center/);
  });
});

describe("draw_shape polygon and line", () => {
  it("closes an unclosed ring so the stored geometry is valid GeoJSON", async () => {
    // Agents write rings the way a human lists corners: without repeating the
    // first one. Rejecting that would fail the most natural call there is, and
    // storing it unclosed would hand MapLibre and turf broken geometry.
    const { store, byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.03],
        [121.54, 25.04],
        [121.53, 25.04],
      ],
      label: "the block",
    });

    expect(out.error).toBeUndefined();
    const ring = (store.getDrawings()[0].geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // 0.01 deg lng at lat 25.035 is ~1007 m, 0.01 deg lat is ~1112 m.
    expect(out.area_m2).toBeGreaterThan(1_050_000);
    expect(out.area_m2).toBeLessThan(1_200_000);
  });

  it("keeps an already closed ring as it is", async () => {
    const { store, byName } = mapReady();
    await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.03],
        [121.54, 25.04],
        [121.53, 25.03],
      ],
    });
    const ring = (store.getDrawings()[0].geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(4);
  });

  it("rejects a ring that cannot enclose anything", async () => {
    const { store, byName } = mapReady();
    for (const coordinates of [
      [
        [121.53, 25.03],
        [121.54, 25.03],
      ],
      // Three points, but the last repeats the first: two distinct corners.
      [
        [121.53, 25.03],
        [121.54, 25.03],
        [121.53, 25.03],
      ],
    ]) {
      const out = await call(byName.draw_shape, { type: "polygon", coordinates });
      expect(out.error).toMatch(/3/);
    }
    expect(store.getDrawings()).toEqual([]);
  });

  it("refuses a ring that encloses no area, however it was written", async () => {
    /*
     * A zero-area shape is invisible to the human and still matches `within`,
     * so "what is inside the area I drew" would answer about an area nobody can
     * see. Collinear points and a self-intersecting bow-tie are the two ways an
     * agent writes one by accident; both used to be accepted with area_m2 0.
     */
    const { store, byName } = mapReady();
    const collinear = await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.535, 25.03],
        [121.54, 25.03],
      ],
    });
    expect(collinear.error).toMatch(/encloses no area/);

    const bowTie = await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.04],
        [121.54, 25.03],
        [121.53, 25.04],
      ],
    });
    expect(bowTie.error).toMatch(/self-intersecting/);

    // Same defect from the circle side: a radius that rounds away to nothing.
    const speck = await call(byName.draw_shape, {
      type: "circle",
      center: { lng: 121.53, lat: 25.03 },
      radius_m: 1e-9,
    });
    expect(speck.error).toMatch(/radius_m/);
    expect(store.getDrawings()).toEqual([]);
    // One metre is small but real, and stays allowed.
    expect((await call(byName.draw_shape, { type: "circle", center: { lng: 121.53, lat: 25.03 }, radius_m: 1 })).error).toBeUndefined();
  });

  it("measures a line in metres, not kilometres", async () => {
    // Same hand-computed anchor as output.test.ts: 0.01 deg of longitude at
    // lat 25.0478 is 1007 m on the sphere turf uses. A reading of ~1 means the
    // units regressed and every distance the agent quotes is 1000x off.
    const { byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "line",
      coordinates: [
        [121.517, 25.0478],
        [121.527, 25.0478],
      ],
    });
    expect(out.length_m).toBe(1007);
    expect(out.area_m2).toBeUndefined();
  });

  it("rejects a line with a single point and coordinates that are not numbers", async () => {
    const { store, byName } = mapReady();
    expect((await call(byName.draw_shape, { type: "line", coordinates: [[121.5, 25]] })).error).toMatch(/2/);
    expect(
      (await call(byName.draw_shape, { type: "line", coordinates: [[121.5, 25], [121.6, "25"]] })).error,
    ).toMatch(/lng/);
    expect(
      (await call(byName.draw_shape, { type: "line", coordinates: [[121.5, 25], [999, 25]] })).error,
    ).toMatch(/lng/);
    expect(store.getDrawings()).toEqual([]);
  });

  it("names the shape kinds it knows instead of failing silently", async () => {
    const { byName } = mapReady();
    const out = await call(byName.draw_shape, { type: "blob", coordinates: [] });
    expect(out.error).toMatch(/circle/);
    expect(out.error).toMatch(/polygon/);
    expect(out.error).toMatch(/line/);
  });

  it("caps the label so one call cannot bloat every later state read", async () => {
    const { byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "line",
      coordinates: [
        [121.5, 25],
        [121.51, 25],
      ],
      label: "x".repeat(MAX_LABEL_CHARS + 1),
    });
    expect(out.error).toMatch(String(MAX_LABEL_CHARS));
  });
});

describe("draw_shape state", () => {
  it("returns the same state object every other tool returns", async () => {
    const { byName } = mapReady();
    const read = await call(byName.get_map_state);
    const out = await call(byName.draw_shape, { type: "circle", center: "Daan Station" });
    expect(Object.keys(out.state ?? {}).sort()).toEqual(Object.keys(read).sort());
  });

  it("lists the drawing in map state, with its measure, for both sources", async () => {
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE] });
    const out = await call(byName.draw_shape, { type: "circle", center: "Daan Station", radius_m: 100 });
    expect(out.state?.drawings.count).toBe(3);
    expect(out.state?.drawings.items).toEqual([
      { id: "drawing:1", kind: "polygon", label: "my walk", source: "user", area_m2: expect.any(Number) },
      { id: "drawing:2", kind: "line", source: "user", length_m: expect.any(Number) },
      { id: "drawing:3", kind: "circle", source: "agent", area_m2: expect.any(Number) },
    ]);
  });

  it("lists the ten most recent drawings and notes, not the ten oldest", async () => {
    // Past the cap the agent's own last shape used to fall off the list it is
    // told to pick `within` ids from, so `drawing:11` looked like it failed.
    const { byName } = mapReady();
    let lastDrawing = "";
    let lastAnnotation = "";
    for (let i = 0; i < 11; i++) {
      lastDrawing =
        ((
          await call(byName.draw_shape, {
            type: "circle",
            center: { lng: 121.53, lat: 25.03 },
            radius_m: 100 + i,
          })
        ).drawing_id as string) ?? "";
      lastAnnotation =
        ((
          await call(byName.annotate, { at: { lng: 121.53, lat: 25.03 }, note: `note ${i}` })
        ).annotation_id as string) ?? "";
    }

    const state = await call(byName.get_map_state);
    expect(state.drawings?.count).toBe(11);
    expect(state.drawings?.items).toHaveLength(10);
    expect(state.drawings?.items.map((d) => d.id)).toContain(lastDrawing);
    expect(state.drawings?.items.map((d) => d.id)).not.toContain("drawing:1");
    expect(state.annotations?.count).toBe(11);
    expect(state.annotations?.items.map((a) => a.id)).toContain(lastAnnotation);
    expect(state.annotations?.items.map((a) => a.id)).not.toContain("annotation:1");
  });

  it("never puts geometry in the answer", async () => {
    const { byName } = mapReady();
    const out = await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.03],
        [121.54, 25.04],
      ],
    });
    // The camera and the visible bounds are the only coordinates any answer
    // carries; nothing of the shape itself leaks out.
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry|121\.54/);
  });
});

describe("annotate", () => {
  it("pins a note and returns the new state, so the agent needs no follow-up read", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.annotate, {
      at: { lng: 121.5436, lat: 25.0334 },
      note: "Viewing at 3pm",
      icon: "clock",
    });
    expect(out.annotation_id).toBe("annotation:1");
    expect(store.getAnnotations()[0]).toEqual({
      id: "annotation:1",
      source: "agent",
      at: [121.5436, 25.0334],
      note: "Viewing at 3pm",
      icon: "clock",
    });
    expect(out.state?.annotations).toEqual({
      count: 1,
      items: [{ id: "annotation:1", note: "Viewing at 3pm", source: "agent" }],
    });
    // Same state object every other tool returns, so no follow-up read differs.
    const read = await call(byName.get_map_state);
    expect(Object.keys(out.state ?? {}).sort()).toEqual(Object.keys(read).sort());
  });

  it("pins by place name and by feature id, the two things an agent actually has", async () => {
    const { store, byName } = mapReady();
    await call(byName.annotate, { at: "Daan Station", note: "meet here" });
    await call(byName.annotate, { at: "osm:way:10", note: "the park" });
    expect(store.getAnnotations().map((a) => a.at)).toEqual([
      [121.5436, 25.0334],
      [121.53575, 25.0295],
    ]);
  });

  it("asks which place it meant instead of pinning the wrong one", async () => {
    // A note dropped on the wrong branch of a 208-branch chain is invisible to
    // an agent that cannot see the map, and wrong to the human who can.
    const { store, byName } = mapReady();
    const out = await call(byName.annotate, { at: "Pxmart", note: "closed today" });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    expect(out.state).toMatchObject({ annotations: { count: 0 } });
    expect(store.getAnnotations()).toEqual([]);
  });

  it("reports an unknown place rather than pinning nothing quietly", async () => {
    const { store, byName } = mapReady();
    expect((await call(byName.annotate, { at: "Shibuya", note: "x" })).error).toBe("unknown place");
    expect(store.getAnnotations()).toEqual([]);
  });

  it("requires a note with words in it, and caps its length", async () => {
    const { store, byName } = mapReady();
    const at = { lng: 121.5436, lat: 25.0334 };
    expect((await call(byName.annotate, { at, note: "   " })).error).toMatch(/note/);
    expect((await call(byName.annotate, { at, note: 7 })).error).toMatch(/note/);
    expect((await call(byName.annotate, { at })).error).toMatch(/note/);
    expect((await call(byName.annotate, { at, note: "x".repeat(MAX_NOTE_CHARS + 1) })).error).toMatch(
      String(MAX_NOTE_CHARS),
    );
    expect(store.getAnnotations()).toEqual([]);
    // Exactly at the cap is fine.
    expect((await call(byName.annotate, { at, note: "x".repeat(MAX_NOTE_CHARS) })).error).toBeUndefined();
  });

  it("requires a location, because a note nobody can find is not an annotation", async () => {
    const { byName } = mapReady();
    expect((await call(byName.annotate, { note: "somewhere" })).error).toMatch(/at/);
  });

  it("truncates a long note in map state but keeps the human's full text in the store", async () => {
    // State is read on every write; an unbounded note would be billed to the
    // agent on every later call. The store keeps what the human wrote.
    const note = "Landlord says the lease starts in March. ".repeat(5).trim();
    const { store, byName } = mapReady();
    const out = await call(byName.annotate, { at: { lng: 121.5436, lat: 25.0334 }, note });
    const shown = out.state?.annotations.items[0].note ?? "";
    expect(shown.length).toBeLessThanOrEqual(80);
    expect(shown.endsWith("…")).toBe(true);
    expect(store.getAnnotations()[0].note).toBe(note);
  });

  it("rejects an icon that is a paragraph", async () => {
    const { byName } = mapReady();
    const out = await call(byName.annotate, {
      at: { lng: 121.5436, lat: 25.0334 },
      note: "hi",
      icon: "x".repeat(40),
    });
    expect(out.error).toMatch(/icon/);
  });

  it("returns no geometry beyond what the caller already knows", async () => {
    const { byName } = mapReady();
    const out = await call(byName.annotate, { at: "Daan Station", note: "meet here" });
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry|121\.54/);
  });
});

describe("find_features / select_features within", () => {
  it("answers 'what is inside the shape I drew' for a shape the human drew", async () => {
    /*
     * The collaboration moment. The drawing was made by hand (source "user")
     * and never passed through a tool, yet the agent can query it by id. If
     * this breaks, the demo's premise — shared state, not screenshots — is gone.
     */
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const out = await call(byName.find_features, {
      within: "drawing:1",
      categories: ["supermarket", "mrt_station"],
    });
    expect(out.error).toBeUndefined();
    // Nearest to the view centre first, as everywhere else.
    expect(idsOf(out.features)).toEqual(["osm:node:30", "osm:node:2"]);
    expect(out.total).toBe(2);
  });

  it("selects exactly the features find_features returned for the same shape", async () => {
    // find/select parity is the contract that lets an agent say "these three"
    // and have the human see three highlights.
    const { store, byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const filter = { within: "drawing:1" };
    const found = await call(byName.find_features, filter);
    const selected = await call(byName.select_features, filter);
    expect(idsOf(found.features)).toEqual(idsOf(selected.selected));
    expect(store.getSelection()).toEqual(idsOf(found.features));
  });

  it("can query a shape the agent drew itself, in the very next call", async () => {
    const { byName } = mapReady();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: "Daan Park Station",
      radius_m: 500,
    });
    const out = await call(byName.find_features, {
      within: drawn.drawing_id as string,
      categories: ["listing", "mrt_station"],
    });
    expect(idsOf(out.features)).toEqual(["listing:01", "osm:node:3"]);
  });

  it("keeps an area feature that only overlaps the shape, not just points inside it", async () => {
    // The park is bigger than the circle; "what is in this circle" must still
    // name it, the same way list_features_in_view keeps a partly visible area.
    const { byName } = mapReady();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: "Daan Park Station",
      radius_m: 300,
    });
    const out = await call(byName.find_features, {
      within: drawn.drawing_id as string,
      categories: ["park"],
    });
    expect(idsOf(out.features)).toEqual(["osm:way:10"]);
  });

  it("refuses a line, because a route has no inside", async () => {
    const { store, byName } = mapReady({ drawings: [USER_DRAWN_LINE], selection: ["osm:node:2"] });
    const find = await call(byName.find_features, { within: "drawing:2" });
    expect(find.error).toMatch(/area drawing/);
    const select = await call(byName.select_features, { within: "drawing:2" });
    expect(select.error).toMatch(/area drawing/);
    expect(select.state).toBeDefined();
    expect(store.getSelection()).toEqual(["osm:node:2"]);
  });

  it("lists the ids it does know when the shape id is wrong", async () => {
    // Guessing (or matching everything) would light up the whole city; telling
    // the agent which ids exist lets it recover in one call.
    const { store, byName } = mapReady({ drawings: [USER_DRAWN_AREA], selection: ["osm:node:2"] });
    const out = await call(byName.find_features, { within: "drawing:99" });
    expect(out.error).toMatch(/drawing/);
    expect(out.known_ids).toEqual(["drawing:1"]);
    expect(out.known_count).toBe(1);
    const select = await call(byName.select_features, { within: "drawing:99" });
    expect(select.known_ids).toEqual(["drawing:1"]);
    expect(store.getSelection()).toEqual(["osm:node:2"]);
  });

  it("combines with the other filters instead of replacing them", async () => {
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const all = await call(byName.find_features, { within: "drawing:1" });
    const narrowed = await call(byName.find_features, {
      within: "drawing:1",
      categories: ["supermarket"],
    });
    expect(idsOf(all.features).length).toBeGreaterThan(1);
    expect(idsOf(narrowed.features)).toEqual(["osm:node:30"]);
    // ...and with near/radius_m: 50 m around Daan Station excludes the shop.
    const tight = await call(byName.find_features, {
      within: "drawing:1",
      near: "Daan Station",
      radius_m: 50,
    });
    expect(idsOf(tight.features)).toEqual(["osm:node:2"]);
  });

  it("returns an empty result, not an error, when the shape is empty", async () => {
    const { byName } = mapReady();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: { lng: 121.4, lat: 25.2 },
      radius_m: 100,
    });
    const out = await call(byName.find_features, { within: drawn.drawing_id as string });
    expect(out).toEqual({ total: 0, returned: 0, features: [] });
  });

  it("survives a feature whose geometry cannot be tested", async () => {
    const { byName } = mapReady({
      features: [
        ...FIXTURE_FEATURES,
        {
          type: "Feature",
          properties: { id: "broken:empty", name: "Empty", category: "park", source: "osm" },
          geometry: { type: "Polygon", coordinates: [] },
        },
      ],
      drawings: [USER_DRAWN_AREA],
    });
    const out = await call(byName.find_features, { within: "drawing:1" });
    expect(out.error).toBeUndefined();
    expect(idsOf(out.features)).not.toContain("broken:empty");
  });
});
