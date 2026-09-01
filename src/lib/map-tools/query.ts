/**
 * The filter engine shared by find_features and select_features. Kept apart
 * from the tool definitions so both tools cannot drift: "the 3 parks I found"
 * and "the 3 parks you selected" must be the same three.
 */
import type { MultiPolygon, Polygon } from "geojson";
import { isMapCategory, type MapCategory, type MapFeature } from "@/lib/store/tier2";
import type { LngLat } from "@/lib/store/map-store";
import { normaliseName, resolvePlaceOne, type PlaceCandidate } from "./gazetteer";
import { distanceMeters, featureCenter } from "./output";
import { featureWithin, MAX_RADIUS_M } from "./shapes";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
/** Walking distance; applied only when the caller gave a `near`. */
export const DEFAULT_RADIUS_M = 800;
/** Same ceiling as draw_shape and describe_surroundings: one radius story. */
export const MAX_QUERY_RADIUS_M = MAX_RADIUS_M;

export type NearResolution =
  /**
   * `name` is the name of whatever the string resolved to, absent for a raw
   * coordinate. Callers that echo the origin back (compare_areas) can then say
   * which "大安" they measured from, which is the one thing the agent that
   * typed a name cannot check for itself.
   */
  | { kind: "point"; center: LngLat; name?: string }
  | { kind: "ambiguous"; candidates: PlaceCandidate[] }
  | { kind: "none" }
  /**
   * A name was given while the bundled datasets were still arriving, so the
   * gazetteer it would have been matched against is missing every station,
   * park and district. Kept apart from `none` because the two ask the caller
   * for opposite things: `none` is a fact about the map, this is a fact about
   * the moment (T-103; see `MapToolStore.isBaseDataLoaded`).
   */
  | { kind: "loading" }
  | { kind: "invalid"; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateLimit(value: unknown): { limit: number } | { error: string } {
  if (value === undefined) return { limit: DEFAULT_LIMIT };
  if (!isNum(value) || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return { error: `limit must be an integer 1..${MAX_LIMIT}` };
  }
  return { limit: value };
}

/**
 * Accepts the six bundled categories and the 18 tier-2 ones alike. Whether a
 * category still has to be fetched is not this function's business: it only
 * says the name exists, so "unknown categories: cafeteria" can never be
 * confused with "the cafe file failed to load".
 */
export function validateCategories(
  value: unknown,
): { categories?: MapCategory[] } | { error: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "categories must be a non-empty array of category names" };
  }
  const bad = value.filter((c) => !isMapCategory(c));
  if (bad.length > 0) return { error: `unknown categories: ${bad.join(", ")}` };
  return { categories: value as MapCategory[] };
}

/**
 * The name filter, or nothing at all. Shared by every tool that takes `query`
 * for the reason `queryFeatures` itself is shared: "the cafes matching latte"
 * must be the same words on screen and city-wide, and a caller that sends a
 * number has to be refused in the same sentence wherever it sent it.
 *
 * Whitespace alone is not a filter: it is trimmed away and the search stays
 * unfiltered, which is what `queryFeatures` makes of it anyway. Settling it
 * here means the tools and the engine cannot disagree about a stray space.
 */
export function validateQuery(value: unknown): { query?: string } | { error: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") return { error: "query must be a string" };
  return { query: value.trim() || undefined };
}

export function validateRadius(value: unknown): { radius_m?: number } | { error: string } {
  if (value === undefined) return {};
  if (!isNum(value) || value <= 0) return { error: "radius_m must be a positive number of metres" };
  // Refused, not clamped: a filter that quietly covers less than it was asked
  // to cover is a lie the agent cannot see. Same rule as draw_shape.
  if (value > MAX_QUERY_RADIUS_M) {
    return { error: `radius_m must be at most ${MAX_QUERY_RADIUS_M} metres` };
  }
  return { radius_m: value };
}

/**
 * `near` accepts the three things an agent can plausibly have: an id it got
 * from a previous call, an explicit coordinate, or a place name a human said.
 * `field` names the parameter in the error messages, because the same three
 * ways of saying "here" are also draw_shape's `center`, annotate's `at` and
 * describe_surroundings' `from`.
 *
 * `baseLoaded` is `MapToolStore.isBaseDataLoaded()` and gates the third form
 * only. It is the *name* that needs the whole gazetteer to be trustworthy: an
 * id names one row that is demonstrably in memory and a coordinate names
 * itself, so neither can be quietly answered with the wrong place, and refusing
 * them would cost the caller an answer it is entitled to. This is the one place
 * that decides which of the three forms a string is, which is why the guard
 * lives here rather than in each of the tools.
 */
export function resolveNear(
  near: unknown,
  features: readonly MapFeature[],
  viewCenter: LngLat | null | undefined,
  baseLoaded: boolean,
  field = "near",
): NearResolution {
  if (typeof near === "string") {
    const trimmed = near.trim();
    if (!trimmed) return { kind: "invalid", error: `${field} must not be empty` };
    const byId = features.find((f) => f.properties?.id === trimmed);
    if (byId) {
      const center = featureCenter(byId);
      if (!center) return { kind: "invalid", error: `feature ${trimmed} has no usable geometry` };
      return { kind: "point", center, name: byId.properties.name };
    }
    if (!baseLoaded) return { kind: "loading" };
    const place = resolvePlaceOne(trimmed, features, viewCenter);
    if (place.kind === "found") {
      return { kind: "point", center: place.entry.center, name: place.entry.name };
    }
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
  /** Case-insensitive substring of any of `QUERY_FIELDS`. */
  query?: string;
  categories?: MapCategory[];
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
 * The whole of what `query` matches: the five fields a place can be *called*.
 *
 * The local name and the English one, because a human says either; `brand`,
 * because a chain is often what someone is looking for and 2,664 of the 9,623
 * branded places in the shipped extract are branded something their name does
 * not say; `cuisine`, because "ramen" and "coffee" name a kind of place rather
 * than a place, and 676 rows answer "coffee_shop" that no name does; `address`,
 * because a street is how a person says where. Folded exactly as place lookup
 * folds, so find_features({query:"Daan Forest Park"}) and set_map_view({place:
 * "Daan Forest Park"}) cannot disagree about whether OSM's "Da-an Forest Park"
 * is a match.
 *
 * Taken over a bag of fields rather than over a feature so that the citywide
 * search index — which holds those same five columns and no features at all
 * (`store/search-index.ts`) — is matched by this exact function and not by a
 * copy of it. That is what makes find_features' `unloaded_matches` count a
 * promise it can keep: the number it discloses for a category is the number
 * naming that category returns, because the same predicate decided both. The
 * index row and the loaded feature are two different types with the same five
 * optional strings on them, and both are passed in whole.
 *
 * A caller's answer may therefore have matched on something the list output
 * does not show — the list stays at three tags per feature (T-97) — which is
 * what `get_place_details` is for.
 *
 * `needle` is expected already normalised, as `queryFeatures` normalises it.
 */
export const QUERY_FIELDS = ["name", "nameEn", "brand", "cuisine", "address"] as const;

/** Anything a query can be matched against: an index row, or a feature's properties. */
export type QueryFields = Partial<Record<(typeof QUERY_FIELDS)[number], string>>;

export function matchesQuery(fields: QueryFields, needle: string): boolean {
  return QUERY_FIELDS.some((field) => normaliseName(fields[field] ?? "").includes(needle));
}

/**
 * A feature belongs to every category it is tagged with, which for the handful
 * of double-tagged POIs is two. One rule everywhere: if you asked for fast_food
 * you get the bakery that also sells fast food, whichever file it came in.
 */
export function inCategories(feature: MapFeature, wanted: ReadonlySet<string>): boolean {
  if (wanted.has(feature.properties.category)) return true;
  const extra = feature.properties.categories;
  return extra !== undefined && extra.some((c) => wanted.has(c));
}

/** Filtered features, nearest to the origin first. Unlocatable features sort last. */
export function queryFeatures(
  features: readonly MapFeature[],
  spec: QuerySpec,
): MapFeature[] {
  const needle = spec.query ? normaliseName(spec.query) || undefined : undefined;
  const categories = spec.categories ? new Set<string>(spec.categories) : null;

  const scored: { feature: MapFeature; distance: number }[] = [];
  for (const feature of features) {
    if (!feature?.properties?.id) continue;
    if (categories && !inCategories(feature, categories)) continue;
    if (needle && !matchesQuery(feature.properties, needle)) continue;
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
