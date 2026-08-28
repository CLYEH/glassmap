/**
 * measure — "how big is that?" for one drawing or one loaded feature.
 *
 * The numbers this tool returns get spoken to someone who cannot see the shape,
 * so a wrong unit, a silent zero or a measurement of the wrong shape is not a
 * rounding problem: it is the whole answer being false. Most of these tests are
 * therefore about the cases where a plausible implementation would return
 * something instead of refusing — a point, an empty polygon, an id that does
 * not exist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import {
  createMemoryToolStore,
  type MapToolStore,
  type MemoryToolStoreInit,
} from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { DATASETS, type GlassMapFeature } from "@/lib/data/schema";
import type { MapStateOutput } from "./state";
import {
  BROKEN_FEATURES,
  DAAN_FOREST_PARK,
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
  known_ids?: string[];
  known_count?: number;
  measured?: string;
  target?: string;
  kind?: string;
  label?: string;
  source?: string;
  name?: string;
  name_en?: string;
  category?: string;
  area_m2?: number;
  perimeter_m?: number;
  length_m?: number;
  total?: number;
  features?: { id: string }[];
  drawing_id?: string;
  drawings?: MapStateOutput["drawings"];
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

describe("measure", () => {
  it("measures a circle the agent just drew, in metres a human can check", async () => {
    /*
     * A 64-sided polygon inscribed in a 500 m circle is ~0.16 % under pi*r^2
     * and 2*pi*r. Drift beyond 2 % means the units or the ring changed, and the
     * agent would be quoting numbers that do not match the shape on screen.
     */
    const { byName } = mapReady();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: "Daan Station",
      radius_m: 500,
      label: "5-minute walk",
    });
    const out = await call(byName.measure, { target: drawn.drawing_id as string });

    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({
      measured: "drawing",
      target: "drawing:1",
      kind: "circle",
      label: "5-minute walk",
      source: "agent",
    });
    expect(out.area_m2).toBeGreaterThan(Math.PI * 500 * 500 * 0.98);
    expect(out.area_m2).toBeLessThan(Math.PI * 500 * 500 * 1.02);
    expect(out.perimeter_m).toBeGreaterThan(2 * Math.PI * 500 * 0.98);
    expect(out.perimeter_m).toBeLessThan(2 * Math.PI * 500 * 1.02);
    expect(Number.isInteger(out.area_m2)).toBe(true);
    expect(Number.isInteger(out.perimeter_m)).toBe(true);
    expect(out.length_m).toBeUndefined();
  });

  it("measures the shape the human drew and agrees with what map state says about it", async () => {
    /*
     * The collaboration case: the human draws, the agent is asked how big it
     * is. Two numbers about the same shape - the one in map state and the one
     * measure returns - disagreeing would be undebuggable for a user who cannot
     * see either.
     */
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const out = await call(byName.measure, { target: "drawing:1" });
    const state = await call(byName.get_map_state);

    expect(out).toMatchObject({
      measured: "drawing",
      kind: "polygon",
      source: "user",
      label: "my walk",
    });
    expect(out.area_m2).toBe(state.drawings?.items[0].area_m2);
    // ~605 m x ~554 m box: about 34 hectares, 2.3 km around.
    expect(out.area_m2).toBe(336085);
    expect(out.perimeter_m).toBe(2321);
  });

  it("gives a line its length and no area, because a route does not enclose anything", async () => {
    const { byName } = mapReady({ drawings: [USER_DRAWN_LINE] });
    const out = await call(byName.measure, { target: USER_DRAWN_LINE.id });
    expect(out).toMatchObject({ measured: "drawing", kind: "line", length_m: 1008 });
    expect(out.area_m2).toBeUndefined();
    expect(out.perimeter_m).toBeUndefined();
  });

  it("measures a loaded feature and says which one it measured", async () => {
    // The park is a polygon in the data, so it has both numbers; the name and
    // category come back so the agent can say what it just measured without a
    // second lookup.
    const { byName } = mapReady();
    const out = await call(byName.measure, { target: DAAN_FOREST_PARK.properties.id });
    expect(out).toMatchObject({
      measured: "feature",
      target: "osm:way:10",
      name: "大安森林公園",
      name_en: "Da-an Forest Park",
      category: "park",
      area_m2: 308088,
      perimeter_m: 2220,
    });
  });

  it("counts every part of a multi-part area, not just the first one", async () => {
    /*
     * Districts and large parks arrive as MultiPolygon when the source splits
     * them. Measuring only the first ring would understate them by whatever the
     * rest is worth, and nothing in the answer would say so.
     */
    const [ring] = (DAAN_FOREST_PARK.geometry as { coordinates: number[][][] }).coordinates;
    const shifted = ring.map(([lng, lat]) => [lng + 0.02, lat]);
    const twoParts: GlassMapFeature = {
      type: "Feature",
      properties: { ...DAAN_FOREST_PARK.properties, id: "osm:relation:99", name: "Two parts" },
      geometry: { type: "MultiPolygon", coordinates: [[ring], [shifted]] },
    };
    const { byName } = mapReady({ features: [twoParts] });
    const out = await call(byName.measure, { target: "osm:relation:99" });
    expect(out.area_m2).toBeGreaterThan(308088 * 1.99);
    expect(out.perimeter_m).toBeGreaterThan(2220 * 1.99);
  });

  it("refuses to measure a point and says what to use instead", async () => {
    /*
     * A station is a point in this dataset. Answering "0 m2" would be read as
     * "a station with no size"; the useful answer is the one the agent actually
     * wants, which is a distance.
     */
    const { byName } = mapReady();
    const out = await call(byName.measure, { target: "osm:node:2" });
    expect(out.error).toMatch(/point/);
    expect(out.error).toMatch(/find_features/);
    expect(out.area_m2).toBeUndefined();
    expect(out.length_m).toBeUndefined();
  });

  it("refuses geometry it cannot measure instead of reporting zero", async () => {
    // A relation that failed to assemble comes through as an empty polygon.
    // "The park is 0 m2" is a false statement about a real park.
    const { byName } = mapReady({ features: BROKEN_FEATURES });
    const out = await call(byName.measure, { target: "broken:empty-polygon" });
    expect(out.error).toMatch(/no measurable extent/);
    expect(out.area_m2).toBeUndefined();
  });

  it("names the drawings that do exist when the id is wrong", async () => {
    /*
     * Same rule as find_features({within}): a drawing id we cannot resolve is
     * answered with the ids that exist and the true count, never with a
     * measurement of some other shape.
     */
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE] });
    const out = await call(byName.measure, { target: "drawing:404" });
    expect(out.error).toMatch(/unknown drawing id/);
    expect(out.known_ids).toEqual(["drawing:1", "drawing:2"]);
    expect(out.known_count).toBe(2);
    // A mistyped drawing id must not be reported as an unknown *feature*: the
    // caller would go looking for the shape in the wrong catalogue.
    expect(out.error).not.toMatch(/feature/);
  });

  it("sends an unknown id back to find_features rather than guessing", async () => {
    const { byName } = mapReady();
    const out = await call(byName.measure, { target: "osm:way:99999" });
    expect(out.error).toMatch(/unknown target/);
    expect(out.error).toMatch(/find_features/);
  });

  it("asks for a target when there is none", async () => {
    const { byName } = mapReady();
    for (const input of [{}, { target: "" }, { target: "   " }, { target: 7 }]) {
      const out = await call(byName.measure, input as Record<string, unknown>);
      expect(out.error, JSON.stringify(input)).toMatch(/target/);
    }
  });
});

/** The fixture proves the logic; the committed data proves the demo. */
describe("measure on the committed Taipei data", () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "data");
  const realFeatures: GlassMapFeature[] = Object.values(DATASETS).flatMap(
    ({ file }) =>
      (
        JSON.parse(readFileSync(join(dataDir, file.replace(/^\/data\//, "")), "utf8")) as {
          features: GlassMapFeature[];
        }
      ).features,
  );

  it("measures the real Da-an Forest Park polygon", async () => {
    // The park is officially about 26 hectares; the committed polygon is
    // simplified, so anything outside 20-30 ha means the geometry or the units
    // regressed rather than the park changing size.
    const store = createMemoryToolStore({ features: realFeatures, view: VIEW });
    const byName = Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
    const found = await call(byName.find_features, {
      query: "Da-an Forest Park",
      categories: ["park"],
      limit: 1,
    });
    const out = await call(byName.measure, { target: found.features?.[0].id as string });
    expect(out.measured).toBe("feature");
    expect(out.area_m2).toBeGreaterThan(200_000);
    expect(out.area_m2).toBeLessThan(300_000);
    expect(out.perimeter_m).toBeGreaterThan(1_500);
    expect(out.perimeter_m).toBeLessThan(4_000);
  });
});
