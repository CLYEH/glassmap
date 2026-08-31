/**
 * Shared shapes for everything a tool says about a *feature*.
 *
 * Two rules drive the design:
 *  - output never contains geometry (an agent pays per token; it gets ids and
 *    can call set_map_view({feature_id}) or select_features({ids}) instead),
 *  - every distance is an integer in metres and every direction is one of eight
 *    compass points, because those are the two things a blind-to-pixels agent
 *    needs in order to describe a map to a human.
 */
import { bbox, bearing as turfBearing, centroid, distance } from "@turf/turf";
import {
  TIER2_TEXT_FIELDS,
  type MapCategory,
  type MapFeature,
  type Tier2TextField,
} from "@/lib/store/tier2";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import { round5 } from "./state";

export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Compass = (typeof COMPASS)[number];

/** Feature as returned by list_features_in_view / find_features / select_features. */
export interface FeatureOutput {
  id: string;
  name: string;
  name_en?: string;
  category: MapCategory;
  /** Present and true only for fabricated demo data, so the agent can say so. */
  sample?: boolean;
  /**
   * The other categories this feature is tagged with, when it has any. Without
   * it, a fast_food search that returns something categorised "bakery" looks
   * like a bug rather than a POI that is both.
   */
  categories?: MapCategory[];
  /** Tier-2 only, and only when the source has them: what makes a POI answer useful. */
  cuisine?: string;
  brand?: string;
  opening_hours?: string;
  /** Great-circle metres from the query origin to this feature's point/centroid. */
  distance_m?: number;
  direction?: Compass;
}

/** 8-point compass label for a bearing in degrees clockwise from north (any range). */
export function compassFromBearing(deg: number): Compass {
  if (!Number.isFinite(deg)) return "N";
  const norm = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(norm / 45) % COMPASS.length];
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Representative point of a feature: a Point uses its own coordinate, any other
 * geometry uses its centroid. Returns null for geometry we cannot use, so
 * callers degrade (no distance) instead of throwing.
 */
export function featureCenter(feature: MapFeature): LngLat | null {
  try {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    const coords =
      geometry.type === "Point"
        ? geometry.coordinates
        : centroid(feature).geometry.coordinates;
    if (!Array.isArray(coords) || !isFiniteNum(coords[0]) || !isFiniteNum(coords[1])) return null;
    return [coords[0], coords[1]];
  } catch {
    return null;
  }
}

/** [west, south, east, north] of a feature, or null when the geometry is unusable. */
export function featureBounds(feature: MapFeature): Bounds | null {
  try {
    if (!feature?.geometry) return null;
    const b = bbox(feature);
    if (!b.every(isFiniteNum)) return null;
    return [b[0], b[1], b[2], b[3]];
  } catch {
    return null;
  }
}

/** Do two [west, south, east, north] boxes overlap? Touching edges count as overlapping. */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Metres (integer) between two [lng, lat] points. */
export function distanceMeters(from: LngLat, to: LngLat): number {
  return Math.round(distance(from, to, { units: "meters" }));
}

/**
 * Small summary of one feature. `from` adds distance/direction; without it the
 * caller has no origin (e.g. an id-only selection) and both are omitted.
 * Direction is omitted at zero distance because a bearing to yourself is noise.
 *
 * ## Lists stay lean; `get_place_details` carries the rest (T-97)
 *
 * A loaded POI can hold fourteen OSM tags (`TIER2_TEXT_FIELDS`). Exactly three
 * of them appear here — cuisine, brand, opening_hours — and every field added
 * since is served by `get_place_details`, one place per call, and by nothing
 * else. Every list output is built from this function: find_features,
 * list_features_in_view, describe_surroundings and the selection echoes, so
 * this is the one place the rule can be kept or lost.
 *
 * The reason is what a list is *for*. Twenty places come back per call and the
 * agent is choosing between them, which cuisine, brand and opening hours are
 * enough to do; an address, a phone number, a website and a wheelchair tag on
 * each of twenty rows is several times the answer's size spent on nineteen
 * places nobody asked about, and it would push the shortlist itself out of
 * reach of the limit. Ask about the one that won instead — that call is cheap,
 * and it is the only call that knows which place the human actually meant.
 *
 * So: nothing is added to `FeatureOutput` because it "would be useful here
 * too". Widening a list is a decision about every list at once.
 */
export function describeFeature(feature: MapFeature, from?: LngLat | null): FeatureOutput {
  const p = feature.properties;
  const out: FeatureOutput = { id: p.id, name: p.name, category: p.category };
  if (p.nameEn) out.name_en = p.nameEn;
  if (p.sample) out.sample = true;
  // "A restaurant" is not an answer to "somewhere vegetarian, open now": these
  // three tags are the whole reason a POI is worth fetching. Absent on the
  // bundled datasets, so nothing about their output changes.
  if (p.categories) out.categories = p.categories;
  if (p.cuisine) out.cuisine = p.cuisine;
  if (p.brand) out.brand = p.brand;
  if (p.opening_hours) out.opening_hours = p.opening_hours;
  if (from) {
    const center = featureCenter(feature);
    if (center) {
      const meters = distanceMeters(from, center);
      out.distance_m = meters;
      if (meters > 0) out.direction = compassFromBearing(turfBearing(from, center));
    }
  }
  return out;
}

/**
 * One place, in full: what `get_place_details` answers with.
 *
 * The other half of the rule above. A list says which places exist and which is
 * nearest; this says everything the page holds about the one that was picked —
 * the same identity fields, its coordinate, and every OSM tag it carries.
 *
 * There is no `distance_m` here on purpose: this call has no origin, and a
 * distance from the view centre would be a number the caller did not ask for
 * and cannot check.
 */
export interface PlaceDetailsOutput extends Partial<Record<Tier2TextField, string>> {
  id: string;
  name: string;
  name_en?: string;
  category: MapCategory;
  /** Present when the place is tagged in more than one category. */
  categories?: MapCategory[];
  /** True only for the fabricated demo listings, which must never read as real. */
  sample?: true;
  /**
   * Where it is, to five decimals (~1 m) — the point for a POI, the centroid
   * for a park or a district. Absent when the geometry is unusable, because a
   * made-up coordinate is worse than none.
   */
  coordinate?: { lng: number; lat: number };
}

/**
 * Everything the page knows about one feature, with nothing invented.
 *
 * Absent means absent: a tag OpenStreetMap does not have for this place is left
 * out rather than sent as null or as an empty string, so an agent reading the
 * answer can tell "nobody has recorded a phone number" from "there is no phone
 * number", and never reports the second when the truth is the first.
 */
export function describePlaceDetails(feature: MapFeature): PlaceDetailsOutput {
  const p = feature.properties;
  const out: PlaceDetailsOutput = { id: p.id, name: p.name, category: p.category };
  if (p.nameEn) out.name_en = p.nameEn;
  if (p.categories) out.categories = p.categories;
  if (p.sample) out.sample = true;
  const center = featureCenter(feature);
  if (center) out.coordinate = { lng: round5(center[0]), lat: round5(center[1]) };
  // By list, in the list's order, so the answer's fields are the same fields in
  // the same order for every place and a tag added upstream needs no change
  // here. Values are the file's own: this layer reports OSM, it does not judge
  // it — `wheelchair` above all (see TIER2_TEXT_FIELDS).
  for (const field of TIER2_TEXT_FIELDS) {
    const value = p[field];
    if (value) out[field] = value;
  }
  return out;
}
