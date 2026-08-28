import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import {
  boundsIntersect,
  compassFromBearing,
  describeFeature,
  featureCenter,
} from "./output";
import { DAAN_FOREST_PARK, SAMPLE_LISTING } from "./test-fixtures";

const ORIGIN: [number, number] = [121.517, 25.0478];

const at = (coordinates: [number, number]): GlassMapFeature => ({
  type: "Feature",
  properties: { id: "test:1", name: "Probe", category: "listing", source: "sample" },
  geometry: { type: "Point", coordinates },
});

describe("compassFromBearing", () => {
  it("labels each 45-degree sector, so 'north-east of you' is never off by a quadrant", () => {
    expect(compassFromBearing(0)).toBe("N");
    expect(compassFromBearing(45)).toBe("NE");
    expect(compassFromBearing(90)).toBe("E");
    expect(compassFromBearing(135)).toBe("SE");
    expect(compassFromBearing(180)).toBe("S");
    expect(compassFromBearing(225)).toBe("SW");
    expect(compassFromBearing(270)).toBe("W");
    expect(compassFromBearing(315)).toBe("NW");
  });

  it("accepts the -180..180 range turf returns and wraps back to N at 360", () => {
    expect(compassFromBearing(-90)).toBe("W");
    expect(compassFromBearing(-45)).toBe("NW");
    expect(compassFromBearing(359)).toBe("N");
    expect(compassFromBearing(360)).toBe("N");
  });
});

describe("describeFeature distance and direction", () => {
  /*
   * Hand-computed against the spherical earth turf uses (R = 6371008.8 m):
   *   0.01 deg of longitude at lat 25.0478
   *     = R * cos(25.0478 deg) * 0.01 deg in rad
   *     = 6371008.8 * 0.905955 * 1.745329e-4 = 1007.4 m
   *   0.01 deg of latitude = 6371008.8 * 1.745329e-4 = 1112.0 m
   * If this ever reads ~1.0 the units regressed from metres to kilometres; if
   * the two swap, lng/lat got transposed somewhere.
   */
  it("reports metres due east as an integer", () => {
    const out = describeFeature(at([121.527, 25.0478]), ORIGIN);
    expect(out.distance_m).toBe(1007);
    expect(out.direction).toBe("E");
  });

  it("reports metres due north as an integer", () => {
    const out = describeFeature(at([121.517, 25.0578]), ORIGIN);
    expect(out.distance_m).toBe(1112);
    expect(out.direction).toBe("N");
  });

  it("measures an area from its centroid, not from its first vertex", () => {
    // Centroid [121.53575, 25.0295]; the first vertex is the SW corner.
    const center = featureCenter(DAAN_FOREST_PARK)!;
    expect(center[0]).toBeCloseTo(121.53575, 6);
    expect(center[1]).toBeCloseTo(25.0295, 6);
    const fromCentroid = describeFeature(DAAN_FOREST_PARK, [121.53575, 25.0295]);
    expect(fromCentroid.distance_m).toBe(0);
  });

  it("omits direction at zero distance, because a bearing to yourself is noise", () => {
    const out = describeFeature(at(ORIGIN), ORIGIN);
    expect(out.distance_m).toBe(0);
    expect(out.direction).toBeUndefined();
  });

  it("omits distance entirely when the caller has no origin", () => {
    const out = describeFeature(SAMPLE_LISTING);
    expect(out.distance_m).toBeUndefined();
    expect(out.direction).toBeUndefined();
  });
});

describe("describeFeature payload", () => {
  it("returns ids and names but never geometry, so output stays cheap", () => {
    const out = describeFeature(DAAN_FOREST_PARK, ORIGIN);
    expect(Object.keys(out).sort()).toEqual([
      "category",
      "direction",
      "distance_m",
      "id",
      "name",
      "name_en",
    ]);
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry|Polygon/);
  });

  it("flags fabricated demo data so the agent can say the listing is not real", () => {
    expect(describeFeature(SAMPLE_LISTING).sample).toBe(true);
    expect(describeFeature(DAAN_FOREST_PARK).sample).toBeUndefined();
  });
});

describe("boundsIntersect", () => {
  it("treats a partly overlapping area as visible (a district is bigger than the screen)", () => {
    expect(boundsIntersect([121.528, 25.018, 121.56, 25.04], [121.525, 25.02, 121.55, 25.045])).toBe(true);
  });

  it("excludes a disjoint box, and counts a shared edge as a hit", () => {
    expect(boundsIntersect([121.5, 25.0, 121.51, 25.01], [121.52, 25.02, 121.53, 25.03])).toBe(false);
    expect(boundsIntersect([121.5, 25.0, 121.52, 25.02], [121.52, 25.02, 121.53, 25.03])).toBe(true);
  });
});
