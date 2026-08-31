import { describe, expect, it } from "vitest";
import { visibleBounds } from "./viewport-bounds";

/**
 * What is left here after T-102: the half of this module that reads a live
 * map. The pure Mercator maths (`approximateBounds`, `zoomToFit`) moved to
 * `@/lib/geo/mercator` with its tests, because the tool layer needs it too and
 * cannot import out of `components/`; `src/lib/geo/re-exports.test.ts` pins
 * that this file still hands both of them out under the same names.
 */

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
