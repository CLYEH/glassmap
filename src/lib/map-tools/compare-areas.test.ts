/**
 * compare_areas — "which of these two neighbourhoods has more of what", in one
 * call instead of one find_features per category per place.
 *
 * The only reason to trust it is that its counts are the counts find_features
 * would give for the same filter, so the parity test against the committed data
 * is the point of this file rather than a detail of it: every number here ends
 * up read out to someone who cannot check it against the map.
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
import { COMPARE_CATEGORIES } from "./compare";
import { DEFAULT_RADIUS_M } from "./query";
import { FIXTURE_FEATURES, VIEW, VIEW_BOUNDS } from "./test-fixtures";

const signal = new AbortController().signal;

interface AreaSide {
  origin?: { lng: number; lat: number };
  name?: string;
  total?: number;
  by_category?: Record<
    string,
    { count: number; nearest?: { id: string; name: string; distance_m: number } }
  >;
}

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  field?: string;
  candidates?: { id: string; name: string }[];
  a?: AreaSide;
  b?: AreaSide;
  radius_m?: number;
  summary?: string[];
  total?: number;
  features?: { id: string }[];
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

const countIn = (side: AreaSide | undefined, category: string) =>
  side?.by_category?.[category]?.count;

describe("compare_areas counting", () => {
  it("counts both places over the same radius and names the nearest of each category", async () => {
    /*
     * The demo's step 5, on the fixture: Daan Station against Daan Park
     * Station. The default radius is a comfortable walk (800 m), the same one
     * find_features uses, which is why the sample listing 811 m from Daan
     * Station is not counted on the a side and the identical listing 244 m from
     * the park station is counted on the b side. If the two sides were ever
     * measured with different radii the whole comparison would be meaningless
     * and nothing on screen would show it.
     */
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, { a: "Daan Station", b: "Daan Park Station" });

    expect(out.error).toBeUndefined();
    expect(out.radius_m).toBe(DEFAULT_RADIUS_M);
    expect(out.a?.total).toBe(2);
    expect(out.b?.total).toBe(4);
    expect(countIn(out.a, "park")).toBe(0);
    expect(countIn(out.b, "park")).toBe(1);
    expect(countIn(out.a, "listing")).toBe(0);
    expect(countIn(out.b, "listing")).toBe(1);

    // The nearest is what makes a count actionable: "one park, 396 m away,
    // osm:way:10" can be selected or flown to; "one park" cannot.
    expect(out.b?.by_category?.park.nearest).toEqual({
      id: "osm:way:10",
      name: "大安森林公園",
      distance_m: 396,
    });
    // Nothing to point at, so no example: an empty `nearest` object would read
    // as a place that exists.
    expect(out.a?.by_category?.park.nearest).toBeUndefined();
    expect(out.a?.by_category?.supermarket.nearest?.distance_m).toBe(174);
  });

  it("widens both sides together when the caller asks for a bigger radius", async () => {
    // One radius for both sides is the invariant; a wider one has to change the
    // answer, or radius_m is being ignored.
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Daan Park Station",
      radius_m: 1000,
    });
    expect(out.radius_m).toBe(1000);
    expect(countIn(out.a, "park")).toBe(1);
    expect(countIn(out.a, "listing")).toBe(1);
    expect(out.a?.total).toBe(5);
    expect(out.b?.total).toBe(5);
  });

  it("gives one summary line per category, including the ones neither place has", async () => {
    /*
     * summary is the field an agent reads out. A category that is silently
     * dropped when both sides are 0 would be indistinguishable from a category
     * nobody asked about, and "there are no schools near either" is a real
     * answer that a listener is entitled to hear.
     */
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, { a: "Daan Station", b: "Daan Park Station" });
    expect(out.summary).toEqual([
      "mrt_station: a 1 vs b 1",
      "park: a 0 vs b 1",
      "school: a 0 vs b 0",
      "supermarket: a 1 vs b 1",
      "listing: a 0 vs b 1",
    ]);
    expect(Object.keys(out.a?.by_category ?? {})).toEqual([...COMPARE_CATEGORIES]);
  });

  it("leaves districts out by default and counts them only when asked", async () => {
    /*
     * The district polygon's centroid is 491 m from Daan Station, so it would
     * be counted by default if districts were treated like neighbours. "Da'an
     * has one district nearby" is noise: the district a place is in is a
     * property of the place, and describe_surroundings answers it as one.
     */
    const { byName } = mapReady();
    const byDefault = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Daan Park Station",
    });
    expect(countIn(byDefault.a, "district")).toBeUndefined();
    expect(byDefault.summary?.some((line) => line.startsWith("district:"))).toBe(false);

    const asked = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Daan Park Station",
      categories: ["district"],
    });
    expect(countIn(asked.a, "district")).toBe(1);
    expect(asked.summary).toEqual(["district: a 1 vs b 0"]);
    // Only what was asked for: a category the caller filtered out must not come
    // back in the totals under another name.
    expect(asked.a?.total).toBe(1);
  });

  it("counts a category once even if it is asked for twice", async () => {
    // Two identical summary lines would read as two separate findings.
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Daan Park Station",
      categories: ["park", "park"],
    });
    expect(out.summary).toEqual(["park: a 0 vs b 1"]);
  });

  it("echoes what each side resolved to, so the agent can tell which 大安 it measured", async () => {
    /*
     * Every ambiguity in this dataset is a name collision, and the agent that
     * typed the name is the one party who cannot see where the count was taken.
     * The origin plus the resolved name is the receipt.
     */
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, { a: "Daan Station", b: "Daan Park Station" });
    expect(out.a?.name).toBe("大安");
    expect(out.a?.origin).toEqual({ lng: 121.5436, lat: 25.0334 });
    expect(out.b?.name).toBe("大安森林公園");
    expect(out.b?.origin).toEqual({ lng: 121.535, lat: 25.033 });

    // A coordinate resolves to nothing but itself; inventing a name for it
    // would be the tool guessing what the human meant.
    const byCoord = await call(byName.compare_areas, {
      a: { lng: 121.5436, lat: 25.0334 },
      b: "osm:node:3",
    });
    expect(byCoord.a?.name).toBeUndefined();
    expect(byCoord.b?.name).toBe("大安森林公園");
    // Same place, named three different ways, must give the same counts.
    expect(byCoord.a?.by_category).toEqual(out.a?.by_category);
  });

  it("says which of the two sides it could not resolve", async () => {
    /*
     * 208 branches share the name "Pxmart" in the real data. Both errors read
     * the same without `field`, and an agent that retries the wrong side gets
     * the same error forever.
     */
    const { byName } = mapReady();
    const badA = await call(byName.compare_areas, { a: "Pxmart", b: "Daan Station" });
    expect(badA.error).toBe("ambiguous place");
    expect(badA.field).toBe("a");
    expect(badA.candidates).toHaveLength(2);
    expect(badA.summary).toBeUndefined();

    const badB = await call(byName.compare_areas, { a: "Daan Station", b: "Pxmart" });
    expect(badB.field).toBe("b");

    const unknown = await call(byName.compare_areas, { a: "Daan Station", b: "Shibuya" });
    expect(unknown.error).toBe("unknown place");
    expect(unknown.field).toBe("b");
  });

  it("refuses a comparison with only one side instead of inventing the other", async () => {
    // Falling back to the view centre would produce a confident answer to a
    // question nobody asked, and the numbers would look exactly as real.
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, { a: "Daan Station" });
    expect(out.error).toMatch(/both a and b/);
    expect(out.a).toBeUndefined();
  });

  it("returns ids and counts, never geometry", async () => {
    const { byName } = mapReady();
    const out = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Daan Park Station",
      radius_m: 5000,
    });
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry/);
  });

  it("answers with zeros rather than an error when nothing is loaded", async () => {
    // An empty dataset is a real state during page load; the honest answer to
    // "compare these two coordinates" is that neither has anything.
    const { byName } = mapReady({ features: [] });
    const out = await call(byName.compare_areas, {
      a: { lng: 121.5436, lat: 25.0334 },
      b: { lng: 121.535, lat: 25.033 },
    });
    expect(out.error).toBeUndefined();
    expect(out.a?.total).toBe(0);
    expect(out.summary).toHaveLength(COMPARE_CATEGORIES.length);
  });
});

/**
 * The fixture proves the logic; only the committed data proves the demo. These
 * run against public/data/*.geojson - the same 2,000-odd features the deployed
 * page loads.
 */
describe("compare_areas on the committed Taipei data", () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "data");
  const realFeatures: GlassMapFeature[] = Object.values(DATASETS).flatMap(
    ({ file }) =>
      (
        JSON.parse(readFileSync(join(dataDir, file.replace(/^\/data\//, "")), "utf8")) as {
          features: GlassMapFeature[];
        }
      ).features,
  );
  const realTools = () => {
    const store = createMemoryToolStore({ features: realFeatures, view: VIEW });
    return Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  };

  it("counts exactly what find_features would count for the same filter", async () => {
    /*
     * This is the tool's licence to exist: it replaces one find_features call
     * per category per place, so any category where the two disagree is a
     * category where the agent is reading out a number the map cannot back up.
     * Hand-check: Daan Park Station has 6 parks within 800 m.
     */
    const byName = realTools();
    const compared = await call(byName.compare_areas, {
      a: "Daan Park Station",
      b: "Zhongshan Station",
    });
    expect(compared.error).toBeUndefined();
    expect(compared.a?.name).toBe("大安森林公園");
    expect(compared.b?.name).toBe("中山");
    expect(countIn(compared.a, "park")).toBe(6);

    for (const category of COMPARE_CATEGORIES) {
      for (const [side, place] of [
        ["a", "Daan Park Station"],
        ["b", "Zhongshan Station"],
      ] as const) {
        const found = await call(byName.find_features, {
          near: place,
          radius_m: DEFAULT_RADIUS_M,
          categories: [category],
          limit: 1,
        });
        expect(countIn(compared[side], category), `${side} ${category}`).toBe(found.total);
        // ...and the example it offers is the one find_features puts first.
        if ((found.total ?? 0) > 0) {
          expect(compared[side]?.by_category?.[category].nearest?.id).toBe(found.features?.[0].id);
        }
      }
    }
  });

  it("stays small enough to read out, even over the whole city", async () => {
    /*
     * Bytes, not characters: a CJK name costs three bytes on the wire. The tool
     * is worth calling only if one comparison is cheaper than the six searches
     * it replaces, and a 10 km radius over 2,000 features is the worst case.
     */
    const byName = realTools();
    const out = await call(byName.compare_areas, {
      a: "Daan Park Station",
      b: "Zhongshan Station",
      radius_m: 10000,
    });
    expect(out.error).toBeUndefined();
    expect(out.a?.total).toBeGreaterThan(500);
    expect(Buffer.byteLength(JSON.stringify(out), "utf8")).toBeLessThan(2000);
  });

  it("refuses a radius wider than the city, on both sides at once", async () => {
    const byName = realTools();
    const out = await call(byName.compare_areas, {
      a: "Daan Park Station",
      b: "Zhongshan Station",
      radius_m: 10001,
    });
    expect(out.error).toMatch(/at most 10000/);
    expect(out.a).toBeUndefined();
  });
});
