/**
 * Screen-space geometry the effects draw with, and the one true-length
 * measurement they need. Pure functions over numbers: no DOM, no map, so the
 * tether's bow, the arc sampling and the ruler's graduation spacing are all
 * unit tested without a browser.
 *
 * Everything here takes ALREADY-PROJECTED points. Projection happens once per
 * frame in the effect (see `surfaces.ts`), which is what keeps a map-space
 * effect honest through a camera move: the numbers below are recomputed from
 * the new screen positions rather than transformed along with a stale group.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Metres between two [lng, lat] points on a sphere. Good to ~0.3% at city scale. */
export function haversineMetres(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True length of a lng/lat path in metres; `closed` adds the closing leg. */
export function pathMetres(
  positions: readonly (readonly [number, number])[],
  closed: boolean,
): number {
  let total = 0;
  for (let i = 1; i < positions.length; i += 1) {
    total += haversineMetres(positions[i - 1], positions[i]);
  }
  if (closed && positions.length > 2) {
    total += haversineMetres(positions[positions.length - 1], positions[0]);
  }
  return total;
}

/** An SVG path through projected points. */
export function pathD(points: readonly Pt[], closed: boolean): string {
  if (points.length === 0) return "";
  const body = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L");
  return `M${body}${closed ? "Z" : ""}`;
}

export interface Walk {
  /** Cumulative length at each point; last entry is the total. */
  at: number[];
  total: number;
  points: readonly Pt[];
  closed: boolean;
}

/** Pre-measures a projected polyline so points along it can be found by distance. */
export function walkPath(points: readonly Pt[], closed: boolean): Walk {
  const at = [0];
  let total = 0;
  const n = points.length;
  const legs = closed ? n : n - 1;
  for (let i = 1; i <= legs; i += 1) {
    const a = points[i - 1];
    const b = points[i % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    at.push(total);
  }
  return { at, total, points, closed };
}

/** The point `s` pixels along a measured path, clamped to its ends. */
export function pointAlong(walk: Walk, s: number): Pt {
  const { at, points, total } = walk;
  if (points.length === 0) return { x: 0, y: 0 };
  if (total <= 0) return points[0];
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < at.length - 1 && at[i] < d) i += 1;
  const t = (d - at[i - 1]) / (at[i] - at[i - 1] || 1);
  const a = points[i - 1];
  const b = points[i % points.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The outward normal of the path at distance `s` — where a graduation tick points. */
export function normalAlong(walk: Walk, s: number): Pt {
  const { at, points, total } = walk;
  if (points.length < 2 || total <= 0) return { x: 0, y: -1 };
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < at.length - 1 && at[i] < d) i += 1;
  const a = points[i - 1];
  const b = points[i % points.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** How far a screen point sits from the nearest edge of the visible corridor. */
const openness = (p: Pt, width: number, height: number) =>
  Math.min(p.x, width - p.x, p.y, height - p.y);

/** The tether bows this fraction of the chord, and never further than the cap. */
export const TETHER_BOW_RATIO = 0.25;
export const TETHER_BOW_MAX_PX = 250;
/** Gap to each origin dot: the chain floats BETWEEN the pings, it never joins them. */
export const TETHER_INSET_PX = 20;
/** Screen spacing of the cased dots (spec: "~9 screen px apart"). */
export const TETHER_SPACING_PX = 9;

/**
 * The quadratic control point of the compare tether.
 *
 * BOW SIGN RULE (fx-r3-verdict finding 2, made deterministic here — the spec's
 * "toward the more open corridor" had no definition an implementer could
 * code): of the two mirror-image arcs, take the one whose apex sits further
 * from the nearest edge of the visible corridor; on a tie — including when
 * both apexes fall outside it — bow east, i.e. towards larger screen x.
 */
export function tetherControl(a: Pt, b: Pt, width: number, height: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy) || 1;
  const offset = Math.min(TETHER_BOW_MAX_PX, TETHER_BOW_RATIO * chord);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const perp = { x: -dy / chord, y: dx / chord };
  const plus = { x: mid.x + perp.x * offset, y: mid.y + perp.y * offset };
  const minus = { x: mid.x - perp.x * offset, y: mid.y - perp.y * offset };
  // The apex of a quadratic bezier is halfway to its control point.
  const apex = (c: Pt) => ({ x: (mid.x + c.x) / 2, y: (mid.y + c.y) / 2 });
  const openPlus = openness(apex(plus), width, height);
  const openMinus = openness(apex(minus), width, height);
  if (openPlus > openMinus) return plus;
  if (openMinus > openPlus) return minus;
  return plus.x >= minus.x ? plus : minus;
}

const bezier = (a: Pt, c: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
};

/**
 * The tether's dots: evenly spaced along the arc by arc length, inset from
 * both origins. Even spacing is what makes the chain read as one object rather
 * than as a bezier's parameterisation, which crowds dots near the control point.
 */
export function tetherDots(
  a: Pt,
  b: Pt,
  control: Pt,
  spacing = TETHER_SPACING_PX,
  inset = TETHER_INSET_PX,
): Pt[] {
  const SAMPLES = 120;
  const lens: number[] = [0];
  let acc = 0;
  let prev = bezier(a, control, b, 0);
  for (let i = 1; i <= SAMPLES; i += 1) {
    const q = bezier(a, control, b, i / SAMPLES);
    acc += Math.hypot(q.x - prev.x, q.y - prev.y);
    lens.push(acc);
    prev = q;
  }
  const usable = acc - 2 * inset;
  if (usable <= spacing) return [];
  const count = Math.floor(usable / spacing) + 1;
  const step = usable / (count - 1);
  const along = (s: number) => {
    let lo = 0;
    while (lo < SAMPLES - 1 && lens[lo + 1] < s) lo += 1;
    const f = (s - lens[lo]) / (lens[lo + 1] - lens[lo] || 1);
    return bezier(a, control, b, (lo + f) / SAMPLES);
  };
  const out: Pt[] = [];
  for (let k = 0; k < count; k += 1) out.push(along(inset + k * step));
  return out;
}

/** A graduation every 100 m of TRUE length; the ruler's identity. */
export const MEASURE_TICK_EVERY_M = 100;
/** However long the shape, the ruler never draws more ticks than this. */
export const MEASURE_TICK_CAP = 240;

/** How many graduations a path of this true length earns. */
export function graduationCount(metres: number): number {
  if (!Number.isFinite(metres) || metres <= 0) return 0;
  return Math.max(1, Math.min(MEASURE_TICK_CAP, Math.round(metres / MEASURE_TICK_EVERY_M)));
}
