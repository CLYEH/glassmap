/**
 * describe_surroundings — the Persona B tool. It is the only answer to "what is
 * around me?" for someone who cannot look at the map, so the parts that matter
 * are: the grouping is by real bearings, the nearest things come first, the
 * answer names the district even where the source polygons have seams, and the
 * whole thing stays small enough to read aloud.
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
import { DATASETS, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { COMPASS, type Compass } from "./output";
import { DISTRICT_FALLBACK_MAX_M, SURROUNDINGS_ITEM_LIMIT } from "./surroundings";
import {
  DAAN_STATION,
  EAST_DISTRICT,
  FIXTURE_FEATURES,
  SEAM_POINT,
  VIEW,
  VIEW_BOUNDS,
  WEST_DISTRICT,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface SurroundingsItem {
  name: string;
  name_en?: string;
  category: FeatureCategory;
  distance_m: number;
  sample?: boolean;
}

interface Surroundings {
  error?: string;
  candidates?: { id: string }[];
  origin?: { lng: number; lat: number };
  district?: string | null;
  groups?: { direction: Compass; items: SurroundingsItem[] }[];
}

function toolsFor(over: MemoryToolStoreInit = {}) {
  const store: MapToolStore = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    ...over,
  });
  const byName = Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  return { store, byName };
}

const describeAround = async (
  tool: GlassMapTool,
  input: Record<string, unknown> = {},
): Promise<Surroundings> => (await tool.execute(input, { signal })) as Surroundings;

const namesIn = (out: Surroundings, direction: Compass) =>
  (out.groups?.find((g) => g.direction === direction)?.items ?? []).map((i) => i.name);

const allItems = (out: Surroundings) => (out.groups ?? []).flatMap((g) => g.items);

describe("describe_surroundings grouping", () => {
  it("groups neighbours by compass direction, nearest first inside each group", async () => {
    // From the fixture view centre: the park station is W, the listing and the
    // park are SW, the shop and Daan station are E. If bearings were computed
    // from anything but the origin these would land in the wrong groups, and a
    // blind user would be sent the wrong way.
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { radius_m: 1000 });

    expect(out.error).toBeUndefined();
    expect(out.groups?.map((g) => g.direction)).toEqual(["E", "SW", "W"]);
    expect(namesIn(out, "E")).toEqual(["全聯福利中心", "大安"]);
    expect(namesIn(out, "SW")).toEqual(["Sample listing 01", "大安森林公園"]);
    expect(namesIn(out, "W")).toEqual(["大安森林公園"]);

    for (const group of out.groups ?? []) {
      const distances = group.items.map((i) => i.distance_m);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      for (const d of distances) expect(Number.isInteger(d)).toBe(true);
    }
  });

  it("orders the groups clockwise from north, so a spoken answer has a shape", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { radius_m: 5000 });
    const order = (out.groups ?? []).map((g) => COMPASS.indexOf(g.direction));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it("defaults to 500 m, close enough to walk to", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings);
    // Daan station is 622 m away: it must not be in the default answer, but a
    // wider radius must find it.
    expect(allItems(out).map((i) => i.name)).not.toContain("大安");
    const wider = await describeAround(byName.describe_surroundings, { radius_m: 1000 });
    expect(allItems(wider).map((i) => i.name)).toContain("大安");
  });

  it("caps the answer at 30 items and keeps the nearest ones", async () => {
    // 40 shops around the corner would be an unreadable answer and an
    // expensive one; the ones that get dropped must be the far ones.
    const many: GlassMapFeature[] = Array.from({ length: 40 }, (_, i) => ({
      type: "Feature",
      properties: {
        id: `osm:node:5${i}`,
        name: `Shop ${i}`,
        category: "supermarket" as const,
        source: "osm" as const,
      },
      geometry: { type: "Point" as const, coordinates: [VIEW.center[0] + 0.0002 * (i + 1), VIEW.center[1]] },
    }));
    const { byName } = toolsFor({ features: many });
    const out = await describeAround(byName.describe_surroundings, { radius_m: 2000 });
    const items = allItems(out);
    expect(SURROUNDINGS_ITEM_LIMIT).toBe(30);
    expect(items).toHaveLength(30);
    expect(items.map((i) => i.name)).toContain("Shop 0");
    expect(items.map((i) => i.name)).not.toContain("Shop 39");
  });

  it("flags fabricated listings so the agent does not describe them as real places", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { radius_m: 1000 });
    const listing = allItems(out).find((i) => i.category === "listing");
    expect(listing?.sample).toBe(true);
    expect(allItems(out).find((i) => i.category === "park")?.sample).toBeUndefined();
  });

  it("keeps both names when the source has them, because the reader may not read Chinese", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { radius_m: 1000 });
    expect(allItems(out)).toContainEqual(
      expect.objectContaining({ name: "大安森林公園", name_en: "Da-an Forest Park", category: "park" }),
    );
  });

  it("returns the origin and no other geometry, so the answer stays cheap", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, {
      from: { lng: 121.123456789, lat: 25.987654321 },
      radius_m: 1000,
    });
    expect(out.origin).toEqual({ lng: 121.12346, lat: 25.98765 });
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry/);
  });
});

describe("describe_surroundings district", () => {
  it("names the district the origin is inside", async () => {
    const { byName } = toolsFor();
    expect((await describeAround(byName.describe_surroundings)).district).toBe("大安區");
  });

  it("does not repeat that district as a neighbour", async () => {
    // "You are in Da'an District, and 400 m south-east there is Da'an
    // District" is noise; the district is answered once, as its own field.
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { radius_m: 5000 });
    expect(allItems(out).map((i) => i.category)).not.toContain("district");
  });

  it("falls back to the nearest district across a simplification seam", async () => {
    /*
     * The committed district polygons are simplified independently, so
     * neighbouring borders do not match and leave gaps of up to ~150 m. A
     * point-in-polygon answer alone would tell a user standing on Zhongxiao
     * road that their location is unknown, in the middle of Taipei.
     */
    const { byName } = toolsFor({ features: [WEST_DISTRICT, EAST_DISTRICT] });
    const out = await describeAround(byName.describe_surroundings, { from: { lng: SEAM_POINT[0], lat: SEAM_POINT[1] } });
    expect(out.district).toBe("西區");
  });

  it("takes the first match when two districts claim the same point", async () => {
    // Overlaps are the other half of independent simplification. Any stable
    // answer beats an arbitrary one; ordering by the loaded data is stable.
    const claim = (id: string, name: string) => ({
      ...WEST_DISTRICT,
      properties: { ...WEST_DISTRICT.properties, id, name },
    });
    const { byName } = toolsFor({ features: [claim("district:a", "甲區"), claim("district:b", "乙區")] });
    const out = await describeAround(byName.describe_surroundings, {
      from: { lng: 121.505, lat: 25.005 },
    });
    expect(out.district).toBe("甲區");
  });

  it("says null rather than guessing when the origin is nowhere near the data", async () => {
    // Nearest-district must not stretch across the sea: claiming Shilin
    // District for a point in Tokyo is worse than admitting ignorance.
    const { byName } = toolsFor({ features: [WEST_DISTRICT, EAST_DISTRICT] });
    const out = await describeAround(byName.describe_surroundings, { from: { lng: 139.7, lat: 35.68 } });
    expect(out.district).toBeNull();
    expect(DISTRICT_FALLBACK_MAX_M).toBe(5000);
  });

  it("says null when no district data is loaded at all", async () => {
    const { byName } = toolsFor({ features: [DAAN_STATION] });
    expect((await describeAround(byName.describe_surroundings)).district).toBeNull();
  });
});

describe("describe_surroundings origin", () => {
  it("accepts a place name, a feature id and a coordinate as the origin", async () => {
    const { byName } = toolsFor();
    const byName_ = await describeAround(byName.describe_surroundings, { from: "Daan Station" });
    const byId = await describeAround(byName.describe_surroundings, { from: "osm:node:2" });
    const byCoord = await describeAround(byName.describe_surroundings, {
      from: { lng: 121.5436, lat: 25.0334 },
    });
    expect(byName_).toEqual(byId);
    expect(byId).toEqual(byCoord);
    expect(byId.origin).toEqual({ lng: 121.5436, lat: 25.0334 });
  });

  it("asks instead of describing the surroundings of the wrong branch", async () => {
    const { byName } = toolsFor();
    const out = await describeAround(byName.describe_surroundings, { from: "Pxmart" });
    expect(out.error).toBe("ambiguous place");
    expect(out.candidates).toHaveLength(2);
    expect(out.groups).toBeUndefined();
  });

  it("reports an unknown place and a malformed radius", async () => {
    const { byName } = toolsFor();
    expect((await describeAround(byName.describe_surroundings, { from: "Shibuya" })).error).toBe(
      "unknown place",
    );
    expect((await describeAround(byName.describe_surroundings, { radius_m: 0 })).error).toMatch(/radius/);
    expect((await describeAround(byName.describe_surroundings, { radius_m: 99999 })).error).toMatch(
      /radius/,
    );
  });

  it("answers with empty groups when nothing is loaded, instead of failing", async () => {
    const { byName } = toolsFor({ features: [] });
    const out = await describeAround(byName.describe_surroundings);
    expect(out.groups).toEqual([]);
    expect(out.district).toBeNull();
    expect(out.error).toBeUndefined();
  });
});

/**
 * The fixture proves the logic; only the committed data proves the demo. These
 * run against public/data/*.geojson, where the district seams actually exist.
 */
describe("describe_surroundings on the committed Taipei data", () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "data");
  const realFeatures: GlassMapFeature[] = Object.values(DATASETS).flatMap(
    ({ file }) =>
      (
        JSON.parse(readFileSync(join(dataDir, file.replace(/^\/data\//, "")), "utf8")) as {
          features: GlassMapFeature[];
        }
      ).features,
  );
  const realTools = (center: [number, number]) => {
    const store = createMemoryToolStore({
      features: realFeatures,
      view: { ...VIEW, center },
    });
    return Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  };

  it("describes Taipei Main Station with its real district and neighbours", async () => {
    const byName = realTools([121.517, 25.0478]);
    const out = await describeAround(byName.describe_surroundings);
    expect(out.district).toBe("中正區");
    expect(allItems(out).length).toBeGreaterThan(0);
    expect(allItems(out).length).toBeLessThanOrEqual(SURROUNDINGS_ITEM_LIMIT);
    for (const item of allItems(out)) expect(item.distance_m).toBeLessThanOrEqual(500);
  });

  it("still names a district in the gap between two simplified boundaries", async () => {
    // 121.513, 25.021 is inside no district polygon in the committed data;
    // the nearest boundary (Zhongzheng, ~75 m) is the honest answer.
    const byName = realTools([121.513, 25.021]);
    expect((await describeAround(byName.describe_surroundings)).district).toBe("中正區");
  });

  it("stays inside the token budget for a busy corner of the city", async () => {
    // Da'an at 1.5 km has 90 candidates in the committed data; the answer must
    // still be one an agent can afford to read on every turn.
    const byName = realTools([121.5436, 25.0334]);
    const out = await describeAround(byName.describe_surroundings, { radius_m: 1500 });
    expect(allItems(out)).toHaveLength(SURROUNDINGS_ITEM_LIMIT);
    expect(JSON.stringify(out).length).toBeLessThan(4000);
  });
});
