/**
 * Everything the tool layer knows about *shapes* — the ones an agent draws with
 * draw_shape and the ones a human draws by hand. Both end up in the same store
 * (`Drawing`), so this module is deliberately free of any notion of who made
 * the shape: validation, geometry building, measuring and membership only.
 *
 * Two invariants the rest of the layer relies on:
 *  - `Drawing.geometry` is always renderable and queryable (Polygon for circle
 *    and polygon, LineString for line), so MapLibre and turf can both take it;
 *  - nothing here throws. Bad input comes back as `{ error }`.
 */
import {
  area as turfArea,
  booleanIntersects,
  booleanPointInPolygon,
  circle as turfCircle,
  length as turfLength,
} from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { Drawing, LngLat } from "@/lib/store/map-store";

export type ShapeKind = Drawing["kind"];
export const SHAPE_KINDS: readonly ShapeKind[] = ["circle", "polygon", "line"];

/** A comfortable walk, the same default find_features uses for `radius_m`. */
export const DEFAULT_CIRCLE_RADIUS_M = 800;
/** Beyond this a "circle" covers the whole city and answers nothing. */
export const MAX_RADIUS_M = 10_000;
/** Vertices in a circle: smooth on screen, ~0.16 % under the true area. */
export const CIRCLE_STEPS = 64;
/** A shape the UI has to render on every frame; an agent cannot send a million points. */
export const MAX_SHAPE_POINTS = 500;
export const MAX_LABEL_CHARS = 80;
export const MAX_NOTE_CHARS = 500;
export const MAX_ICON_CHARS = 24;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === "string" && (SHAPE_KINDS as readonly string[]).includes(v);
}

/** Only an area has an inside, so only these can answer `within`. */
export function isAreaGeometry(g: Geometry | null | undefined): g is Polygon | MultiPolygon {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
}

export function validateRadiusM(
  value: unknown,
  fallback: number,
): { radius_m: number } | { error: string } {
  if (value === undefined) return { radius_m: fallback };
  if (!isNum(value) || value <= 0) return { error: "radius_m must be a positive number of metres" };
  if (value > MAX_RADIUS_M) return { error: `radius_m must be at most ${MAX_RADIUS_M} metres` };
  return { radius_m: value };
}

export function validatePosition(value: unknown, where: string): { point: Position } | { error: string } {
  const ok =
    Array.isArray(value) &&
    value.length === 2 &&
    isNum(value[0]) &&
    isNum(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90;
  if (!ok) return { error: `${where} must be [lng, lat] with lng -180..180 and lat -90..90` };
  return { point: [value[0] as number, value[1] as number] };
}

export function validatePositions(
  value: unknown,
  min: number,
): { points: Position[] } | { error: string } {
  if (!Array.isArray(value) || value.length < min) {
    return { error: `coordinates must be an array of at least ${min} [lng, lat] pairs` };
  }
  if (value.length > MAX_SHAPE_POINTS) {
    return { error: `coordinates must have at most ${MAX_SHAPE_POINTS} points` };
  }
  const points: Position[] = [];
  for (let i = 0; i < value.length; i++) {
    const p = validatePosition(value[i], `coordinates[${i}]`);
    if ("error" in p) return p;
    points.push(p.point);
  }
  return { points };
}

const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/**
 * A ring the way an agent writes it (corners, no repeat) turned into the ring
 * GeoJSON demands (first === last). Refusing the unclosed form would fail the
 * most natural call there is; storing it would hand the map broken geometry.
 */
export function toRing(points: Position[]): { ring: Position[] } | { error: string } {
  const ring = samePosition(points[0], points[points.length - 1]) ? points : [...points, points[0]];
  const distinct = new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;
  if (distinct < 3) return { error: "a polygon needs at least 3 distinct points" };
  return { ring };
}

/** A circle as a polygon, because everything downstream only knows polygons. */
export function circleGeometry(center: LngLat, radius_m: number): Polygon {
  return turfCircle(center, radius_m, { steps: CIRCLE_STEPS, units: "meters" }).geometry;
}

export interface ShapeMeasure {
  /** Areas only, square metres. */
  area_m2?: number;
  /** Lines only, metres. */
  length_m?: number;
}

/** The one number a human can check a drawing against. Empty when unmeasurable. */
export function measureGeometry(geometry: Geometry): ShapeMeasure {
  try {
    const feature = { type: "Feature", properties: {}, geometry } as Feature;
    if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
      return { length_m: Math.round(turfLength(feature, { units: "meters" })) };
    }
    if (isAreaGeometry(geometry)) return { area_m2: Math.round(turfArea(feature)) };
  } catch {
    // Unusable geometry loses its measure; it must not lose the whole answer.
  }
  return {};
}

export interface ExtentMeasure extends ShapeMeasure {
  /** Areas only, metres: the length of the outline, holes included. */
  perimeter_m?: number;
}

/**
 * What `measure` reports: the numbers measureGeometry gives, plus the perimeter
 * of an area. Kept apart from measureGeometry because map state lists every
 * drawing on every call and does not need a second number per shape, while
 * `measure` is asked about one shape at a time and "how far is it around" is
 * half of what a human means by "how big is that".
 */
export function measureExtent(geometry: Geometry): ExtentMeasure {
  const base = measureGeometry(geometry);
  if (base.area_m2 === undefined) return base;
  try {
    // turf's length walks every ring of a (Multi)Polygon, so this is the
    // outline of the shape as drawn, not of its bounding box.
    const feature = { type: "Feature", properties: {}, geometry } as Feature;
    return { ...base, perimeter_m: Math.round(turfLength(feature, { units: "meters" })) };
  } catch {
    // An area we can measure but not walk still answers with its area.
    return base;
  }
}

/**
 * Is this feature in that area? A point has to be inside; anything with extent
 * only has to overlap, for the same reason list_features_in_view keeps a park
 * that is bigger than the screen — "what is in this circle" must still name it.
 */
export function featureWithin(area: Polygon | MultiPolygon, feature: GlassMapFeature): boolean {
  try {
    const g = feature?.geometry;
    if (!g) return false;
    if (g.type === "Point") return booleanPointInPolygon(g.coordinates as Position, area);
    return booleanIntersects(g, area);
  } catch {
    return false;
  }
}

/** Optional free text: absent stays absent, present must be short and non-blank. */
export function validateOptionalText(
  value: unknown,
  field: string,
  max: number,
): { text?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return { error: `${field} must be a string` };
  const text = value.trim();
  if (!text) return { error: `${field} must not be empty` };
  if (text.length > max) return { error: `${field} must be at most ${max} characters` };
  return { text };
}

export function validateRequiredText(
  value: unknown,
  field: string,
  max: number,
): { text: string } | { error: string } {
  if (value === undefined || value === null) return { error: `${field} is required` };
  const out = validateOptionalText(value, field, max);
  if ("error" in out) return out;
  return { text: out.text as string };
}

/** Shortened for state output; the ellipsis says the store still has the rest. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
