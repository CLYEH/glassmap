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
import { normaliseName } from "./gazetteer";
import { matchesQuery } from "./query";

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

/** One category holding features with this name that this session has not loaded. */
export interface UnloadedMatch {
  category: MapCategory;
  /**
   * How many features matching the query live in that category and are *not*
   * already in memory. A floor, never a ceiling — as long as the index is not older than the files it indexes (one generator run writes both; a partial --only re-export is the way to break that, and validate() is the guard): naming the category returns
   * at least this many (see `unloadedMatches` for the one case where it
   * returns more).
   */
  count: number;
}

/**
 * How many categories the disclosure names. It is a pointer to the next call,
 * not a report: past a handful the agent is reading a table instead of picking
 * a category, and every row costs tokens on every search. The largest are kept
 * — a category with more matches is the more likely thing the human meant —
 * and anything dropped is counted rather than hidden.
 */
export const UNLOADED_MATCH_LIMIT = 6;

export interface UnloadedMatchDisclosure {
  unloaded_matches?: UnloadedMatch[];
  /** Categories that also matched and did not fit; absent when none were dropped. */
  unloaded_matches_omitted?: number;
}

/**
 * What a *named* search could have found, in the categories it did not search.
 *
 * This is the answer to the defect that made the citywide index exist: on a
 * fresh page, `find_features({query: "starbucks"})` searches the six bundled
 * datasets, finds nothing, and — before this — said nothing about the 151
 * Starbucks stores that word reaches in a cafe file it never fetched (152 rows
 * are Starbucks; one of them is written 星巴克 and nothing else). An agent
 * cannot see that the map is empty; the honest answer has to carry the reason.
 *
 * Four rules, and each one is a promise:
 *
 *  - **It never loads a category.** The disclosure is the whole feature: it
 *    tells the agent what to ask for next and lets it decide. Fetching 2.5 MB
 *    because someone typed a word would make what is on the map a function of
 *    what was searched for, which is the determinism `store/tier2.ts` protects.
 *  - **All five fields, matched by `matchesQuery`** — the same predicate
 *    `queryFeatures` uses, over the same name/nameEn/brand/cuisine/address.
 *    Until T-102 this counted names only, and the reason was sound at the time:
 *    `count` is read as "how many I get if I name this category", and the
 *    loaded search matched names and nothing else, so counting the index's
 *    other three columns would have promised features the follow-up call could
 *    not return. On the shipped index "coffee" is 354 rows by name and 834 over
 *    all five — mostly `cuisine=coffee_shop`. That asymmetry has dissolved
 *    rather than been overridden: the loaded search now reads the same five
 *    fields (`matchesQuery`, one function, both call sites), so the 834 is what
 *    naming those categories actually returns. Widening one side alone would
 *    have been the lie; widening the predicate is what keeps the count a
 *    promise.
 *  - **Already-loaded rows do not count.** A row is skipped when *any* of its
 *    categories is in memory, because those matches are already in the answer
 *    above and this field is about what is missing from it. For the handful of
 *    dual-tagged ids (12 city-wide) that makes `count` a floor: naming the
 *    other category returns those rows too.
 *  - **Silence when the index is not here.** Missing, still arriving,
 *    unreadable, never shipped — all four omit the field, exactly as the
 *    tier-2 disclosure omits itself on a page with no manifest.
 *
 * The load is awaited rather than fired and forgotten, for the reason
 * `planCategories` awaits its manifest fetch: the same question must get the
 * same answer twice. A background load would make the first search of a
 * session quietly weaker than the second, and an agent that cannot see the
 * screen has no way to notice. The wait is bounded by `httpFetchJson`'s own
 * timeout, and a failure costs the field and nothing else — never the answer.
 */
export async function unloadedMatches(
  store: MapToolStore,
  query: string | undefined,
): Promise<UnloadedMatchDisclosure> {
  const needle = query ? normaliseName(query) : "";
  // No query, no promise to make: a search that matched every name has nothing
  // to say about names elsewhere, and must not pay for the index to say it.
  if (!needle) return {};
  await store.loadSearchIndex();
  const index = store.getSearchIndex();
  if (!index) return {};

  // The six bundled datasets are in memory on every page, so a row of theirs
  // could never be "unloaded". They cannot appear in the index today (it is
  // derived from the 18 tier-2 files) — this is what keeps that true if one
  // ever does, rather than disclosing a category the map already searched.
  const loaded = new Set<string>([...FEATURE_CATEGORIES, ...store.getLoadedCategories()]);
  const counts = new Map<MapCategory, number>();
  for (const entry of index) {
    if (entry.categories.some((c) => loaded.has(c))) continue;
    if (!matchesQuery(entry, needle)) continue;
    // Counted under every category it is filed in, the same rule
    // `countByCategory` uses: naming either one returns this feature.
    for (const category of entry.categories) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  if (counts.size === 0) return {};

  // Biggest first, then alphabetical, so two runs of one query name the same
  // categories in the same order — including which ones fall off the end.
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, UNLOADED_MATCH_LIMIT);
  return {
    unloaded_matches: shown.map(([category, count]) => ({ category, count })),
    ...(ranked.length > shown.length
      ? { unloaded_matches_omitted: ranked.length - shown.length }
      : {}),
  };
}
