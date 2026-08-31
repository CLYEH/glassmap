import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, type Bounds, type MapView } from "@/lib/store/map-store";
import {
  ROW_FIT_FILL,
  ROW_FIT_MAX_ZOOM,
  ROW_POINT_ZOOM,
  boundsCenter,
  frameFor,
  frameForPoint,
  geometryBounds,
  hasExtent,
} from "./frame-model";

const view = (patch: Partial<MapView> = {}): MapView => ({ ...DEFAULT_VIEW, ...patch });

/** A plausible desktop corridor over Taipei: ~0.09 deg wide, ~0.05 deg tall. */
const CORRIDOR: Bounds = [121.47, 25.02, 121.56, 25.07];

const POINT = (lng: number, lat: number): Bounds => [lng, lat, lng, lat];

describe("geometryBounds", () => {
  it("boxes a hand-drawn polygon, which is what its sidebar row flies to", () => {
    expect(
      geometryBounds({
        type: "Polygon",
        coordinates: [
          [
            [121.51, 25.03],
            [121.53, 25.03],
            [121.53, 25.05],
            [121.51, 25.05],
            [121.51, 25.03],
          ],
        ],
      }),
    ).toEqual([121.51, 25.03, 121.53, 25.05]);
  });

  it("boxes a route line, however many vertices OSRM sent back", () => {
    expect(
      geometryBounds({
        type: "LineString",
        coordinates: [
          [121.6, 25.1],
          [121.4, 25.0],
          [121.5, 25.2],
        ],
      }),
    ).toEqual([121.4, 25.0, 121.6, 25.2]);
  });

  it("boxes a point as itself, so a degenerate shape is framed like a place", () => {
    expect(geometryBounds({ type: "Point", coordinates: [121.5, 25] })).toEqual([
      121.5, 25, 121.5, 25,
    ]);
  });

  it("walks a MultiPolygon's extra nesting rather than stopping at the first ring", () => {
    // The walker is depth-agnostic on purpose: a circle is a Polygon today, but
    // `Drawing.geometry` is typed `Geometry`, and a box that silently covered
    // only part of a shape would frame a flight that misses half of it.
    expect(
      geometryBounds({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [121.5, 25.0],
              [121.51, 25.0],
              [121.51, 25.01],
              [121.5, 25.0],
            ],
          ],
          [
            [
              [121.6, 25.1],
              [121.61, 25.1],
              [121.61, 25.11],
              [121.6, 25.1],
            ],
          ],
        ],
      }),
    ).toEqual([121.5, 25.0, 121.61, 25.11]);
  });

  it("covers every member of a GeometryCollection", () => {
    expect(
      geometryBounds({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [121.4, 25.0] },
          {
            type: "LineString",
            coordinates: [
              [121.5, 25.1],
              [121.6, 25.2],
            ],
          },
        ],
      }),
    ).toEqual([121.4, 25.0, 121.6, 25.2]);
  });

  it("is null for anything it cannot box, so the row simply does not offer to fly", () => {
    // Degrading to null rather than throwing is what keeps a broken shape from
    // taking the whole panel down — and what keeps the affordance honest: no
    // box, no button.
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: "LineString", coordinates: [] })).toBeNull();
    expect(
      geometryBounds({ type: "Point", coordinates: [Number.NaN, 25] }),
    ).toBeNull();
  });
});

describe("hasExtent / boundsCenter", () => {
  it("calls a point's own box no extent, and an area's box an extent", () => {
    expect(hasExtent(POINT(121.5, 25))).toBe(false);
    expect(hasExtent([121.5, 25, 121.51, 25])).toBe(true);
    expect(hasExtent([121.5, 25, 121.5, 25.01])).toBe(true);
  });

  it("centres a box", () => {
    expect(boundsCenter([121.5, 25, 121.6, 25.2])).toEqual([121.55, 25.1]);
  });
});

/**
 * The two rules a row click obeys. They differ because the two things in the
 * list differ: a place has no size, so the person's own frame is respected; an
 * area IS its size, so the click frames it. Getting this backwards is the bug
 * these tests exist to catch — a click on 大安區 answering with one street
 * corner, or a click on a cafe throwing away the neighbourhood somebody had
 * just framed.
 */
describe("frameFor", () => {
  it("keeps a point's flight from ever zooming out — the search box's rule", () => {
    const framed = frameFor(POINT(121.55, 25.04), view({ zoom: 17 }), CORRIDOR);
    expect(framed.center).toEqual([121.55, 25.04]);
    expect(framed.zoom).toBe(17);
  });

  it("closes in on a point when the camera is further out than reading distance", () => {
    expect(frameFor(POINT(121.55, 25.04), view({ zoom: 11 }), CORRIDOR).zoom).toBe(ROW_POINT_ZOOM);
  });

  it("zooms in on an area smaller than the corridor, and centres it", () => {
    // A park a tenth of the corridor across (and short enough that the width is
    // what binds): the fit is log2(10) closer, minus the padding. Anything that
    // merely centred it would leave the map where it was and answer "show me
    // this" with a dot.
    const park: Bounds = [121.514, 25.0455, 121.523, 25.0465];
    const framed = frameFor(park, view({ zoom: 12 }), CORRIDOR);
    expect(framed.center).toEqual([(121.514 + 121.523) / 2, (25.0455 + 25.0465) / 2]);
    expect(framed.zoom).toBeCloseTo(12 + Math.log2((0.09 / 0.009) * ROW_FIT_FILL), 9);
    expect(framed.zoom).toBeGreaterThan(12);
  });

  it("widens for an area that does not fit — the one flight allowed to zoom out", () => {
    // Standing inside a district at street level, "show me the district" can
    // only mean pulling back. Refusing to would answer a click with nothing
    // visibly happening, which is the failure the row is meant to remove.
    const district: Bounds = [121.5, 25.0, 121.58, 25.06];
    const framed = frameFor(district, view({ zoom: 18 }), CORRIDOR);
    expect(framed.zoom).toBeLessThan(18);
    expect(framed.center[0]).toBeCloseTo(121.54, 9);
    expect(framed.center[1]).toBeCloseTo(25.03, 9);
  });

  it("stops closing in at street scale, however small the shape", () => {
    // A 5 m circle drawn by hand fits at zoom 21 — one doorway and no context.
    const tiny: Bounds = [121.5, 25.0, 121.50005, 25.00005];
    expect(frameFor(tiny, view({ zoom: 12 }), CORRIDOR).zoom).toBe(ROW_FIT_MAX_ZOOM);
  });

  it("falls back to the point rule when nothing has reported a corridor yet", () => {
    // No map, or no `moveend` yet: the honest answer to "I do not know how much
    // you can see" is to change as little as possible.
    const framed = frameFor([121.5, 25.0, 121.58, 25.06], view({ zoom: 16 }), null);
    expect(framed.zoom).toBe(16);
    expect(framed.center[0]).toBeCloseTo(121.54, 9);
    expect(framed.center[1]).toBeCloseTo(25.03, 9);
  });
});

describe("frameForPoint", () => {
  it("is the point rule, for a note that is only ever a coordinate", () => {
    expect(frameForPoint([121.53, 25.04], view({ zoom: 10 }))).toEqual({
      center: [121.53, 25.04],
      zoom: ROW_POINT_ZOOM,
    });
    expect(frameForPoint([121.53, 25.04], view({ zoom: 18 })).zoom).toBe(18);
  });
});
