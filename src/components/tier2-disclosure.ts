import { featureCategories, type MapFeature, type Tier2Category } from "@/lib/store/tier2";

/** One line of the loaded-categories disclosure. */
export interface LoadedCategoryRow {
  category: Tier2Category;
  /** How many loaded features a query for this category would search. */
  count: number;
}

/**
 * What the chrome says about the point-of-interest data in memory.
 *
 * Counted from the features themselves rather than read off the manifest,
 * which is the same rule the legend follows: the number on screen is what the
 * store is holding, never what a file says it should be holding. The two differ
 * — the manifest counts rows in a file, and a POI tagged both bakery and
 * fast_food is one feature the store keeps once but which answers either query,
 * so `featureCategories` counts it under both. What is printed is therefore
 * exactly what a `find_features({categories:[c]})` would search, which is the
 * only number a person can act on.
 *
 * The order is `loaded`'s: the store sorts it, so this never leaks which
 * category the agent happened to ask for first.
 */
export function loadedCategoryRows(
  loaded: readonly Tier2Category[],
  features: readonly MapFeature[],
): LoadedCategoryRow[] {
  if (loaded.length === 0) return [];
  const wanted = new Set<string>(loaded);
  const tally = new Map<string, number>();
  for (const feature of features) {
    for (const category of featureCategories(feature)) {
      if (wanted.has(category)) tally.set(category, (tally.get(category) ?? 0) + 1);
    }
  }
  return loaded.map((category) => ({ category, count: tally.get(category) ?? 0 }));
}
