import { describe, expect, it } from "vitest";
import {
  MEASURE_TICK_CAP,
  TETHER_BOW_MAX_PX,
  TETHER_INSET_PX,
  TETHER_SPACING_PX,
  graduationCount,
  normalAlong,
  pathD,
  pathMetres,
  pointAlong,
  tetherControl,
  tetherDots,
  walkPath,
  type Pt,
} from "./geometry";

const square: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("walking a projected path", () => {
  it("measures the closing leg only when the shape is closed", () => {
    expect(walkPath(square, true).total).toBe(400);
    expect(walkPath(square, false).total).toBe(300);
  });

  it("finds a point by distance along the path", () => {
    const walk = walkPath(square, true);
    expect(pointAlong(walk, 50)).toEqual({ x: 50, y: 0 });
    expect(pointAlong(walk, 150)).toEqual({ x: 100, y: 50 });
  });

  it("clamps rather than wrapping, so a runner never restarts mid-lap", () => {
    const walk = walkPath(square, true);
    expect(pointAlong(walk, -10)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(walk, 999)).toEqual({ x: 0, y: 0 });
  });

  it("survives a degenerate path instead of dividing by its zero length", () => {
    const walk = walkPath([{ x: 5, y: 5 }], false);
    expect(pointAlong(walk, 10)).toEqual({ x: 5, y: 5 });
    expect(Number.isFinite(normalAlong(walk, 10).x)).toBe(true);
  });

  it("gives a normal ACROSS the path — that is the ruler's whole identity", () => {
    // A graduation that ran along the stroke would be indistinguishable from
    // the dashed drawing being measured (fx r1 finding 5).
    const walk = walkPath(square, true);
    const n = normalAlong(walk, 50);
    expect(Math.abs(n.x)).toBeCloseTo(0, 6);
    expect(Math.abs(n.y)).toBeCloseTo(1, 6);
  });

  it("closes the SVG path only when the shape is closed", () => {
    expect(pathD(square, true).endsWith("Z")).toBe(true);
    expect(pathD(square, false).endsWith("Z")).toBe(false);
    expect(pathD([], true)).toBe("");
  });
});

describe("true-length graduations", () => {
  it("measures a lng/lat path on the sphere, not in degrees", () => {
    // One degree of latitude is ~111 km; a screen-space measurement would put
    // a "100 m" graduation wherever the zoom happened to be.
    const metres = pathMetres(
      [
        [121.5, 25.0],
        [121.5, 25.009],
      ],
      false,
    );
    expect(metres).toBeGreaterThan(950);
    expect(metres).toBeLessThan(1050);
  });

  it("adds the closing leg for an area", () => {
    const ring: [number, number][] = [
      [121.5, 25.0],
      [121.51, 25.0],
      [121.51, 25.01],
    ];
    expect(pathMetres(ring, true)).toBeGreaterThan(pathMetres(ring, false));
  });

  it("puts one graduation every 100 m", () => {
    expect(graduationCount(1000)).toBe(10);
    expect(graduationCount(2500)).toBe(25);
  });

  it("caps the graduations, so a city-scale perimeter cannot flood the DOM", () => {
    expect(graduationCount(10_000_000)).toBe(MEASURE_TICK_CAP);
  });

  it("still draws one tick for a shape shorter than the interval", () => {
    // "Measured drawing:1 — 40 m" with no mark at all would read as a failure.
    expect(graduationCount(40)).toBe(1);
    expect(graduationCount(0)).toBe(0);
  });
});

describe("the compare tether", () => {
  const a: Pt = { x: 200, y: 400 };
  const b: Pt = { x: 600, y: 400 };

  it("bows toward the more open corridor", () => {
    // BOW SIGN RULE (fx-r3-verdict finding 2). With both origins low in a tall
    // frame, the open side is upward: the arc must not bow off the bottom edge.
    const control = tetherControl(a, b, 800, 500);
    expect(control.y).toBeLessThan(400);
  });

  it("bows east on a tie, so the same pair always draws the same arc", () => {
    // A vertical chord centred in a symmetric frame has two equally open
    // sides; without a stated tie-break the arc would flip between renders.
    const control = tetherControl({ x: 400, y: 200 }, { x: 400, y: 600 }, 800, 800);
    expect(control.x).toBeGreaterThan(400);
  });

  it("caps the bow, so a cross-city pair does not arc off the screen", () => {
    const control = tetherControl({ x: 0, y: 400 }, { x: 4000, y: 400 }, 4000, 800);
    expect(Math.abs(control.y - 400)).toBeLessThanOrEqual(TETHER_BOW_MAX_PX);
  });

  it("floats BETWEEN the pings: every dot clears both origins", () => {
    // The inset is what stops the chain reading as a route from A to B.
    const dots = tetherDots(a, b, tetherControl(a, b, 800, 800));
    for (const dot of dots) {
      expect(Math.hypot(dot.x - a.x, dot.y - a.y)).toBeGreaterThanOrEqual(TETHER_INSET_PX - 1);
      expect(Math.hypot(dot.x - b.x, dot.y - b.y)).toBeGreaterThanOrEqual(TETHER_INSET_PX - 1);
    }
  });

  it("spaces the dots evenly by arc length, not by bezier parameter", () => {
    // Sampling t uniformly crowds dots near the control point; the chain then
    // reads as a smear at the apex and a dotted line at the ends.
    const dots = tetherDots(a, b, tetherControl(a, b, 800, 800));
    const gaps = dots.slice(1).map((d, i) => Math.hypot(d.x - dots[i].x, d.y - dots[i].y));
    for (const gap of gaps) expect(gap).toBeCloseTo(TETHER_SPACING_PX, 0);
  });

  it("draws no chain at all when the two places are almost the same point", () => {
    // Two dots at 4 px apart would be a smudge between two overlapping rings.
    expect(tetherDots({ x: 100, y: 100 }, { x: 104, y: 100 }, { x: 102, y: 98 })).toEqual([]);
  });
});
