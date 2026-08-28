/**
 * The filter engine shared by find_features and select_features. Kept apart
 * from the tool definitions so both tools cannot drift: "the 3 parks I found"
 * and "the 3 parks you selected" must be the same three.
 */
import type { MultiPolygon, Polygon } from "geojson";
import { isFeatureCategory, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import type { LngLat } from "@/lib/store/map-store";
import { normaliseName, resolvePlaceOne, type PlaceCandidate } from "./gazetteer";
import { distanceMeters, featureCenter } from "./output";
import { featureWithin } from "./shapes";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
/** Walking distance; applied only when the caller gave a `near`. */
export const DEFAULT_RADIUS_M = 800;

export type NearResolution =
  | { kind: "point"; center: LngLat }
  | { kind: "ambiguous"; candidates: PlaceCandidate[] }
  | { kind: "none" }
  | { kind: "invalid"; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateLimit(value: unknown): { limit: number } | { error: string } {
  if (value === undefined) return { limit: DEFAULT_LIMIT };
  if (!isNum(value) || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return { error: `limit must be an integer 1..${MAX_LIMIT}` };
  }
  return { limit: value };
}

export function validateCategories(
  value: unknown,
): { categories?: FeatureCategory[] } | { error: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "categories must be a non-empty array of category names" };
  }
  const bad = value.filter((c) => !isFeatureCategory(c));
  if (bad.length > 0) return { error: `unknown categories: ${bad.join(", ")}` };
  return { categories: value as FeatureCategory[] };
}

export function validateRadius(value: unknown): { radius_m?: number } | { error: string } {
  if (value === undefined) return {};
  if (!isNum(value) || value <= 0) return { error: "radius_m must be a positive number of metres" };
  return { radius_m: value };
}

/**
 * `near` accepts the three things an agent can plausibly have: an id it got
 * from a previous call, an explicit coordinate, or a place name a human said.
 * `field` names the parameter in the error messages, because the same three
 * ways of saying "here" are also draw_shape's `center`, annotate's `at` and
 * describe_surroundings' `from`.
 */
export function resolveNear(
  near: unknown,
  features: readonly GlassMapFeature[],
  viewCenter?: LngLat | null,
  field = "near",
): NearResolution {
  if (typeof near === "string") {
    const trimmed = near.trim();
    if (!trimmed) return { kind: "invalid", error: `${field} must not be empty` };
    const byId = features.find((f) => f.properties?.id === trimmed);
    if (byId) {
      const center = featureCenter(byId);
      if (!center) return { kind: "invalid", error: `feature ${trimmed} has no usable geometry` };
      return { kind: "point", center };
    }
    const place = resolvePlaceOne(trimmed, features, viewCenter);
    if (place.kind === "found") return { kind: "point", center: place.entry.center };
    if (place.kind === "ambiguous") return { kind: "ambiguous", candidates: place.candidates };
    return { kind: "none" };
  }
  if (near && typeof near === "object") {
    const { lng, lat } = near as { lng?: unknown; lat?: unknown };
    if (isNum(lng) && isNum(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      return { kind: "point", center: [lng, lat] };
    }
    return { kind: "invalid", error: `${field} {lng,lat} must be lng -180..180 and lat -90..90` };
  }
  return { kind: "invalid", error: `${field} must be a feature id, a place name, or {lng,lat}` };
}

export interface QuerySpec {
  /** Case-insensitive substring of name or nameEn. */
  query?: string;
  categories?: FeatureCategory[];
  /** Distances are measured from here and the result is sorted by them. */
  origin: LngLat;
  /** Drops anything further than this from the origin. */
  radius_m?: number;
  /**
   * Keeps only what is inside this area (a drawing's geometry). Applied on top
   * of every other filter, never instead of one.
   */
  within?: Polygon | MultiPolygon;
}

/**
 * Same folding as place lookup, so find_features({query:"Daan Forest Park"})
 * and set_map_view({place:"Daan Forest Park"}) cannot disagree about whether
 * OSM's "Da-an Forest Park" is a match.
 */
function matchesQuery(feature: GlassMapFeature, needle: string): boolean {
  const p = feature.properties;
  return (
    normaliseName(p.name ?? "").includes(needle) || normaliseName(p.nameEn ?? "").includes(needle)
  );
}

/** Filtered features, nearest to the origin first. Unlocatable features sort last. */
export function queryFeatures(
  features: readonly GlassMapFeature[],
  spec: QuerySpec,
): GlassMapFeature[] {
  const needle = spec.query ? normaliseName(spec.query) || undefined : undefined;
  const categories = spec.categories ? new Set<string>(spec.categories) : null;

  const scored: { feature: GlassMapFeature; distance: number }[] = [];
  for (const feature of features) {
    if (!feature?.properties?.id) continue;
    if (categories && !categories.has(feature.properties.category)) continue;
    if (needle && !matchesQuery(feature, needle)) continue;
    if (spec.within && !featureWithin(spec.within, feature)) continue;
    const center = featureCenter(feature);
    const distance = center ? distanceMeters(spec.origin, center) : Number.POSITIVE_INFINITY;
    if (spec.radius_m !== undefined && distance > spec.radius_m) continue;
    scored.push({ feature, distance });
  }
  // Infinity - Infinity is NaN, which makes Array.sort undefined; compare explicitly.
  scored.sort(
    (a, b) =>
      (a.distance === b.distance ? 0 : a.distance - b.distance) ||
      a.feature.properties.id.localeCompare(b.feature.properties.id),
  );
  return scored.map((s) => s.feature);
}
