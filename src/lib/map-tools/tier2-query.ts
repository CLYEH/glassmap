/**
 * The one place that decides what a query searched, and what it did not.
 *
 * Every tool that takes `categories` asks this module the same question, so
 * find_features, select_features, list_features_in_view, describe_surroundings
 * and compare_areas cannot disagree about which categories were in scope — the
 * same reason `queryFeatures` is shared rather than reimplemented per tool.
 *
 * Two rules, both from the tier-2 design:
 *  - naming a category is what fetches it (whole city, once), so a category
 *    query is answered over the whole city or refused with the reason;
 *  - a query with no category is answered over what is in memory and *says so*.
 *    Silence would let an agent report "no cafes near the station" when it never
 *    looked at a cafe, and nothing on screen would contradict it.
 */
import { FEATURE_CATEGORIES } from "@/lib/data/schema";
import type { MapToolStore } from "@/lib/store/map-store";
import {
  isTier2Category,
  sortedCategories,
  type MapCategory,
  type Tier2Category,
} from "@/lib/store/tier2";

/**
 * How many features select_features will highlight in one call once a tier-2
 * category is involved. A citywide category runs to thousands: highlighting all
 * of them tells the human nothing, costs the share link its budget, and is
 * never what "show me the cafes" meant. The six bundled datasets are exempt —
 * they are small, bounded, and callers have relied on "select every match"
 * since the tool shipped.
 */
export const SELECT_MATCH_LIMIT = 500;

/** A category that exists city-wide but was not part of this answer. */
export interface UnsearchedCategory {
  category: Tier2Category;
  /** From the manifest: how many exist in the whole city, without loading any. */
  citywide_count: number;
}

/** Spread into a tool's answer. Both fields are absent when nothing was left out. */
export interface Tier2Disclosure {
  searched_categories?: string[];
  unsearched_categories?: UnsearchedCategory[];
}

export interface CategoryPlan {
  /** Filter for `queryFeatures`; undefined means "no category filter at all". */
  categories?: MapCategory[];
  disclosure: Tier2Disclosure;
  /** Tier-2 categories the manifest knows about; 0 when it was never read. */
  tier2Available: number;
}

/** Alphabetical, so two runs of the same query list the same categories in the same order. */
function toUnsearched(
  store: MapToolStore,
  loaded: readonly Tier2Category[],
): UnsearchedCategory[] {
  const manifest = store.getTier2Manifest();
  if (!manifest) return [];
  return manifest.categories
    .filter((entry) => !loaded.includes(entry.category))
    .map((entry) => ({ category: entry.category, citywide_count: entry.count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Turns the caller's `categories` into a filter, loading whatever it names.
 *
 * Categories are loaded one at a time in sorted order: the store then holds the
 * same features in the same order whichever order the agent listed them in,
 * which is what makes two identical questions two identical answers.
 *
 * `base` is the tool's own default filter (describe_surroundings and
 * compare_areas each exclude `district`); omit it for the tools whose default
 * is "no filter".
 */
export async function planCategories(
  store: MapToolStore,
  requested: MapCategory[] | undefined,
  base?: readonly MapCategory[],
): Promise<CategoryPlan | { error: string }> {
  if (requested) {
    for (const category of sortedCategories(requested.filter(isTier2Category))) {
      const result = await store.loadCategory(category);
      // Answering with the categories that did load would be a partial answer
      // the agent cannot see the edge of. Name the file that failed instead.
      if (!result.ok) return { error: result.error };
    }
    return { categories: requested, disclosure: {}, tier2Available: 0 };
  }

  // A bare query is the only path that needs the manifest: it is how the answer
  // can name what it skipped. A missing manifest means there are no tier-2
  // files at all, which is a page with nothing to disclose, not a failure.
  await store.loadTier2Manifest();
  const loaded = store.getLoadedCategories();
  const searched = [...(base ?? FEATURE_CATEGORIES), ...loaded];
  const unsearched = toUnsearched(store, loaded);
  return {
    categories: base ? [...searched] : undefined,
    disclosure: unsearched.length
      ? { searched_categories: searched, unsearched_categories: unsearched }
      : {},
    tier2Available: store.getTier2Manifest()?.categories.length ?? 0,
  };
}

/**
 * What a name lookup could not have found. `set_map_view({place})` resolves
 * against loaded features only — it cannot fetch 18 files to check a name —
 * so an "unknown place" has to admit which categories were never in the index.
 */
export async function unsearchedForLookup(store: MapToolStore): Promise<Tier2Disclosure> {
  await store.loadTier2Manifest();
  const unsearched = toUnsearched(store, store.getLoadedCategories());
  return unsearched.length ? { unsearched_categories: unsearched } : {};
}
