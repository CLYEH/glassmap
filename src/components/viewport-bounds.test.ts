import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, type MapView } from "@/lib/store/map-store";
import { approximateBounds } from "./viewport-bounds";

const view = (patch: Partial<MapView> = {}): MapView => ({ ...DEFAULT_VIEW, ...patch });

/**
 * These bounds are what `list_features_in_view` answers with when the page runs
 * without WebGL, so they have to be a real viewport extent, not a placeholder:
 * an agent that asks "what is on screen?" must get the same answer it would get
 * from a live map.
 */
describe("approximateBounds", () => {
  it("spans width/worldSize of the globe horizontally (512 px tiles)", () => {
    // At zoom 12 the world is 512 * 2^12 = 2,097,152 px, so 1024 px of viewport
    // is 1024/2097152 of 360 deg = 0.17578125 deg of longitude, centred.
    const [west, , east] = approximateBounds(view({ center: [121.5175, 25.0478], zoom: 12 }), 1024, 768);
    expect(east - west).toBeCloseTo(0.17578125, 10);
    expect((west + east) / 2).toBeCloseTo(121.5175, 10);
  });

  it("is conformal: a square viewport on the equator spans equal degrees", () => {
    // Mercator has no distortion at the equator, so lat span must equal lng
    // span there. This is the check that catches a wrong y/lat conversion,
    // which a symmetric-looking but incorrect formula would still pass.
    const [west, south, east, north] = approximateBounds(view({ center: [0, 0], zoom: 12 }), 1024, 1024);
    expect(north - south).toBeCloseTo(east - west, 6);
    expect(north).toBeCloseTo(-south, 10);
  });

  it("covers fewer degrees of latitude away from the equator", () => {
    // Mercator stretches north-south with latitude, so the same pixels show
    // less ground in degrees. Comparing the same viewport at two latitudes
    // fails if the code just reuses the longitude span for latitude.
    const equator = approximateBounds(view({ center: [0, 0], zoom: 12 }), 1024, 1024);
    const taipei = approximateBounds(view({ center: [121.5175, 25.0478], zoom: 12 }), 1024, 1024);
    expect(taipei[3] - taipei[1]).toBeLessThan(equator[3] - equator[1]);
  });

  it("halves the extent for every zoom level", () => {
    const z12 = approximateBounds(view({ zoom: 12 }), 1024, 768);
    const z13 = approximateBounds(view({ zoom: 13 }), 1024, 768);
    expect(z13[2] - z13[0]).toBeCloseTo((z12[2] - z12[0]) / 2, 10);
    expect(z13[3] - z13[1]).toBeCloseTo((z12[3] - z12[1]) / 2, 6);
  });

  it("returns west < east and south < north for any viewport", () => {
    for (const zoom of [0, 5, 12, 18]) {
      for (const lat of [-80, -25, 0, 25, 80]) {
        const [west, south, east, north] = approximateBounds(view({ center: [121, lat], zoom }), 800, 600);
        expect(west).toBeLessThan(east);
        expect(south).toBeLessThan(north);
      }
    }
  });

  it("stays inside the Mercator limits at zoom 0", () => {
    // A viewport taller than the projected world must not produce NaN or a
    // latitude past the pole.
    const [, south, , north] = approximateBounds(view({ center: [0, 0], zoom: 0 }), 512, 2048);
    expect(Number.isFinite(south)).toBe(true);
    expect(Number.isFinite(north)).toBe(true);
    expect(south).toBeGreaterThanOrEqual(-86);
    expect(north).toBeLessThanOrEqual(86);
  });
});
