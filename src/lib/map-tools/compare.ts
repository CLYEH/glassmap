/**
 * compare_areas — "is it better around Daan Park or around Zhongshan?" answered
 * in one call instead of six.
 *
 * Everything here counts with the same engine find_features uses (queryFeatures
 * over the same origin, radius and categories), because the whole value of the
 * tool is that the numbers it reads out are the numbers the agent would get by
 * asking for each category separately. A second, cheaper counting path here
 * would eventually disagree with find_features, and nobody listening to the
 * answer could tell which half was wrong.
 */
import type { FeatureCategory, GlassMapFeature } from "@/lib/data/schema";
import type { LngLat } from "@/lib/store/map-store";
import { distanceMeters, featureCenter } from "./output";
import { queryFeatures } from "./query";
import { round5 } from "./state";
import { NEIGHBOUR_CATEGORIES } from "./surroundings";

/**
 * What gets compared unless the caller says otherwise: everything except
 * `district`. Counting how many district polygons fall within 800 m of a
 * station says something about the map's geometry and nothing about the place.
 */
export const COMPARE_CATEGORIES: FeatureCategory[] = NEIGHBOUR_CATEGORIES;

/** One example per category: enough to name a place, not enough to be a list. */
export interface NearestOutput {
  id: string;
  name: string;
  distance_m: number;
}

export interface CategoryCount {
  count: number;
  /** Absent when count is 0, so "nothing there" cannot be read as a place. */
  nearest?: NearestOutput;
}

export interface AreaSummary {
  origin: { lng: number; lat: number };
  /** What a place name or feature id resolved to; absent for a raw coordinate. */
  name?: string;
  /** Features of the requested categories inside the radius, all categories together. */
  total: number;
  by_category: Record<string, CategoryCount>;
}

/**
 * One side of the comparison. Every requested category gets an entry even when
 * it is empty: a missing key would mean "you did not ask", and an agent reading
 * the answer aloud must be able to say "no supermarkets" with confidence.
 */
export function summariseArea(
  features: readonly GlassMapFeature[],
  origin: LngLat,
  radius_m: number,
  categories: readonly FeatureCategory[],
  name?: string,
): AreaSummary {
  const by_category: Record<string, CategoryCount> = {};
  for (const category of categories) by_category[category] = { count: 0 };

  // Nearest first, so the first feature of a category is that category's nearest.
  const matched = queryFeatures(features, { origin, radius_m, categories: [...categories] });
  for (const feature of matched) {
    const bucket = by_category[feature.properties.category];
    if (!bucket) continue;
    bucket.count += 1;
    if (bucket.nearest) continue;
    const center = featureCenter(feature);
    if (!center) continue;
    bucket.nearest = {
      id: feature.properties.id,
      name: feature.properties.name,
      distance_m: distanceMeters(origin, center),
    };
  }

  return {
    origin: { lng: round5(origin[0]), lat: round5(origin[1]) },
    ...(name ? { name } : {}),
    total: matched.length,
    by_category,
  };
}

/**
 * The comparison as sentences, one per category, in the order they were asked
 * for. This is the field an agent reads out; by_category is what it reasons
 * over. Both sides appear on every line, including 0 vs 0, because "you did not
 * mention schools" and "neither place has one" are different answers.
 */
export function compareSummary(
  a: AreaSummary,
  b: AreaSummary,
  categories: readonly FeatureCategory[],
): string[] {
  return categories.map(
    (c) => `${c}: a ${a.by_category[c]?.count ?? 0} vs b ${b.by_category[c]?.count ?? 0}`,
  );
}
