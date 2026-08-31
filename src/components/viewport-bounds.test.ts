import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, type Bounds, type MapView } from "@/lib/store/map-store";
import { approximateBounds, visibleBounds, zoomToFit } from "./viewport-bounds";

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

/**
 * A stand-in for a live map's `unproject`, north-up unless `bearing` says
 * otherwise. Its one load-bearing detail is where the camera centre lands:
 * `map.setPadding({ right: lane })` moves MapLibre's centre point to
 * `(width - lane) / 2`, i.e. the middle of the corridor the inspector leaves
 * visible, and that is what makes "centre" and "bounds" comparable at all.
 */
function fakeUnproject({
  center,
  width,
  height,
  lane,
  degPerPx = 0.0001,
  bearing = 0,
}: {
  center: [number, number];
  width: number;
  height: number;
  lane: number;
  degPerPx?: number;
  bearing?: number;
}) {
  const cx = (width - lane) / 2;
  const cy = height / 2;
  const theta = (bearing * Math.PI) / 180;
  return ([x, y]: [number, number]) => {
    const dx = (x - cx) * degPerPx;
    const dy = (y - cy) * degPerPx;
    return {
      lng: center[0] + dx * Math.cos(theta) - dy * Math.sin(theta),
      lat: center[1] - (dx * Math.sin(theta) + dy * Math.cos(theta)),
    };
  };
}

const CENTER: [number, number] = [121.5175, 25.0478];

/**
 * `get_map_state` publishes `center` and `bounds` in the same answer and
 * `list_features_in_view` filters on `bounds`, so an agent reads "north-east
 * of centre" straight off the two. The inspector is laid OVER the map, so
 * `map.getBounds()` — the whole canvas — describes a rectangle whose middle is
 * behind glass and is not the centre we report. These tests pin the pair
 * together: whatever the lane is, the bounds we publish are the visible
 * corridor and the centre we publish is in the middle of it.
 */
describe("visibleBounds", () => {
  it("reports the corridor beside the inspector, not the whole canvas", () => {
    const width = 1440;
    const lane = 336;
    const unproject = fakeUnproject({ center: CENTER, width, height: 900, lane });
    const [west, south, east, north] = visibleBounds(unproject, width, 900, lane);
    // 1104 px of corridor at 0.0001 deg/px, and the full canvas height.
    expect(east - west).toBeCloseTo((width - lane) * 0.0001, 10);
    expect(north - south).toBeCloseTo(900 * 0.0001, 10);
  });

  it("puts the reported centre in the middle of the reported bounds", () => {
    const width = 1440;
    const lane = 336;
    const unproject = fakeUnproject({ center: CENTER, width, height: 900, lane });
    const [west, , east] = visibleBounds(unproject, width, 900, lane);
    const fraction = (CENTER[0] - west) / (east - west);
    expect(fraction).toBeGreaterThan(1 / 3);
    expect(fraction).toBeLessThan(2 / 3);
    expect((west + east) / 2).toBeCloseTo(CENTER[0], 10);
  });

  it("is what publishing map.getBounds() got wrong: half a lane of drift", () => {
    // The regression this replaces. Asking a PADDED map for the full canvas
    // width is exactly what `map.getBounds()` returns, and the two errors it
    // makes are both measurable: the box reaches a whole lane further east
    // than anything on screen, and its midpoint therefore sits half a lane
    // east of the `center` published beside it.
    const width = 1440;
    const lane = 336;
    const unproject = fakeUnproject({ center: CENTER, width, height: 900, lane });
    const canvas = visibleBounds(unproject, width, 900, 0);
    const corridor = visibleBounds(unproject, width, 900, lane);
    expect(canvas[2] - corridor[2]).toBeCloseTo(lane * 0.0001, 10);
    expect((canvas[0] + canvas[2]) / 2 - CENTER[0]).toBeCloseTo((lane / 2) * 0.0001, 10);
    expect((corridor[0] + corridor[2]) / 2 - CENTER[0]).toBeCloseTo(0, 10);
  });

  it("is dead centre with no lane, which is the sheet tier and a hidden panel", () => {
    // Below 921px the inspector is a bottom sheet and the map container is
    // shortened instead of overlaid, so nothing is subtracted and the corridor
    // is the whole canvas.
    const width = 800;
    const unproject = fakeUnproject({ center: CENTER, width, height: 486, lane: 0 });
    const [west, south, east, north] = visibleBounds(unproject, width, 486, 0);
    expect((west + east) / 2).toBeCloseTo(CENTER[0], 10);
    expect((south + north) / 2).toBeCloseTo(CENTER[1], 10);
    expect(east - west).toBeCloseTo(width * 0.0001, 10);
  });

  it("boxes all four corners when the map is rotated", () => {
    // A rotated corridor does not fit in the box its two opposite corners
    // make; `getBounds()` uses four for the same reason, and the centre has to
    // stay in the middle of whichever box we report.
    const width = 1440;
    const lane = 336;
    const unproject = fakeUnproject({ center: CENTER, width, height: 900, lane, bearing: 45 });
    const [west, south, east, north] = visibleBounds(unproject, width, 900, lane);
    // Turned 45 deg, a w x h rectangle spans (w + h) / sqrt(2) east-west. Two
    // opposite corners would have claimed (w - h) / sqrt(2), nearly ten times
    // too narrow here, which is the whole reason all four are unprojected.
    expect(east - west).toBeCloseTo(((width - lane + 900) / Math.SQRT2) * 0.0001, 10);
    expect((west + east) / 2).toBeCloseTo(CENTER[0], 10);
    expect((south + north) / 2).toBeCloseTo(CENTER[1], 10);
  });
});

/**
 * The `fitBounds` answer, computed from two boxes instead of a live map. It is
 * what a click on an inspector row uses to frame a district or a drawn circle
 * (`frame-model`), and it has to work on a page that never got a GPU — which is
 * exactly why it measures against the corridor the store already publishes
 * rather than against a canvas.
 */
describe("zoomToFit", () => {
  const corridor: Bounds = [121.47, 25.02, 121.56, 25.07];

  it("gains a zoom level for every halving of the target", () => {
    // The whole claim in one line: zoom is log2 of scale, so a target half as
    // wide is one level closer. A fit that got this wrong would still look
    // plausible at one scale and be visibly wrong at another. Both boxes are
    // deliberately short, so the width is what binds and the comparison is
    // between two exact longitude ratios.
    const half: Bounds = [121.5, 25.045, 121.545, 25.0451];
    const quarter: Bounds = [121.5, 25.045, 121.5225, 25.0451];
    expect(zoomToFit(12, corridor, quarter, 1) - zoomToFit(12, corridor, half, 1)).toBeCloseTo(
      1,
      10,
    );
  });

  it("leaves the zoom alone for a target exactly the size of the corridor", () => {
    expect(zoomToFit(12, corridor, corridor, 1)).toBeCloseTo(12, 10);
  });

  it("spends `fill` of the corridor and keeps the rest as padding", () => {
    // 0.8 is a fifth of the corridor held back, i.e. log2(0.8) of a level.
    expect(zoomToFit(12, corridor, corridor, 0.8)).toBeCloseTo(12 + Math.log2(0.8), 10);
  });

  it("is decided by whichever axis runs out first", () => {
    // As wide as the corridor but twice as tall: it has to fit by height, so
    // the answer is further out than the width alone would have said.
    const tall: Bounds = [121.47, 25.02, 121.56, 25.12];
    expect(zoomToFit(12, corridor, tall, 1)).toBeLessThan(12);
    // The width axis on its own says "exactly 12" — proof the height decided.
    expect(zoomToFit(12, corridor, [121.47, 25.02, 121.56, 25.07], 1)).toBeCloseTo(12, 10);
  });

  it("lets an axis with no extent constrain nothing", () => {
    // A horizontal line has zero height. Treating that as "fits at any zoom"
    // would divide by zero; treating it as unconstrained is the honest reading
    // — the width still decides.
    const line: Bounds = [121.5, 25.04, 121.545, 25.04];
    expect(zoomToFit(12, corridor, line, 1)).toBeCloseTo(12 + Math.log2(0.09 / 0.045), 10);
  });

  it("measures latitude through the projection, not in degrees", () => {
    // Mercator stretches north-south with latitude, so a tall box is not the
    // fraction of a tall corridor that its degrees suggest. Over 120 deg of
    // corridor and 30 deg of target the two answers differ by a quarter of a
    // zoom level — and the whole point of a fit is that the thing lands inside
    // the frame, not a quarter-level outside it. The target is narrow enough
    // that the height is what binds.
    const wide: Bounds = [0, -60, 100, 60];
    const target: Bounds = [40, 0, 60, 30];
    // The textbook Mercator ordinate, written differently from the module's:
    // an independent route to the same ratio.
    const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const projected = (y(60) - y(-60)) / (y(30) - y(0));
    expect(zoomToFit(3, wide, target, 1)).toBeCloseTo(3 + Math.log2(projected), 9);
    // Degrees would have said 120 / 30 = 4. They are not the same fit.
    expect(projected).toBeGreaterThan(4.5);
  });

  it("returns the current zoom when there is nothing to fit", () => {
    // A target with no extent at all is a point, and a corridor with none is a
    // map that has not reported a viewport. Neither is a fit; the caller decides
    // what a point deserves (see `frame-model.frameFor`).
    expect(zoomToFit(13.5, corridor, [121.5, 25.04, 121.5, 25.04], 1)).toBe(13.5);
    expect(zoomToFit(13.5, [121.5, 25, 121.5, 25], [121.4, 25, 121.6, 25.1], 1)).toBe(13.5);
  });
});
