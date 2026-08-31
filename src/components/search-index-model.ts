import { normaliseName } from "@/lib/map-tools/gazetteer";
import { distanceMeters } from "@/lib/map-tools/output";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import type { SearchIndexEntry } from "@/lib/store/search-index";
import { isTier2Category, type Tier2Category } from "@/lib/store/tier2";
import { TIER2_SINGULAR } from "./category-labels";

/**
 * The half of the search box that knows the whole city.
 *
 * `search-model.ts` searches what the map is *holding*, which on a fresh page is
 * 2,063 bundled features and nothing else. This searches the citywide index
 * (`lib/store/search-index.ts`): 31,057 points of interest across all 18
 * categories, whether or not a single one of their files has been fetched. It is
 * the same defect the tool layer's `unloaded_matches` answers, on the surface a
 * person uses — "starbucks" on a fresh page found nothing, over a city holding
 * 152 of them.
 *
 * ## An index row is not a feature, and this module never pretends otherwise
 *
 * Nothing here is on the map. A row cannot be selected, highlighted, or handed
 * to `get_place_details`, because the store does not hold the feature it names —
 * only a name, a kind and a position. That is why the row a person picks has to
 * *load its category first* (`SearchBox`), and why every field here is display
 * or geometry and none of it is passed anywhere as a feature.
 *
 * ## Only categories this session has not loaded
 *
 * A row whose category is already in memory is dropped, because
 * `searchLoadedFeatures` has already offered that place as a real feature, with
 * its tags and its selectable id. The rule is `unloadedMatches`' rule, and for
 * the same reason: this list is what is *missing* from the one above it. It also
 * makes the box self-healing — pick one café and the whole cafe category loads,
 * so every other café in the index turns into a rich row on the next keystroke.
 *
 * ## Wider than the tool's disclosure, on purpose
 *
 * `unloadedMatches` counts **names only**, because its number is read as "how
 * many I get if I name this category" and `find_features` once loaded matches
 * names. This box matches name, English name, brand, cuisine and address,
 * because a person types the word in their head and has no follow-up call to
 * make. See the divergence note in `search-model.ts`: same folding
 * (`normaliseName`), different field set, and the difference is load-bearing in
 * both directions.
 */

/** One citywide row: a place this map could show, and does not yet. */
export interface IndexHit {
  id: string;
  name: string;
  /** The English name, when the index carries one that is not the title. */
  nameEn?: string;
  /** The street address, when the index carries one. */
  address?: string;
  /**
   * The category a pick loads. The first tier-2 category of the row's sorted
   * set, which is the one `mergeTier2` will report as the feature's `category`
   * once the file is in memory — so the word this row shows is the word the
   * loaded place will show.
   */
  category: Tier2Category;
  /** The category in words: "Cafe", "Convenience store". */
  what: string;
  /** Where a pick flies to, at the index's own 5 decimals. */
  center: LngLat;
  /** Metres from the view centre, by the same measure the tools report. */
  distanceM: number;
  /** Whether it is on screen right now; the first sort key, as above. */
  inView: boolean;
}

export interface IndexAnswer {
  /** The capped rows, best first. */
  hits: IndexHit[];
  /** How many rows matched in all. */
  total: number;
  /** Matches the cap left out: `total - hits.length`. */
  overflow: number;
}

/**
 * How many citywide rows the dropdown offers.
 *
 * Fewer than the loaded cap (`SEARCH_LIMIT`, eight) because these rows cost
 * more to accept: each one downloads a category file and changes what the map
 * is holding. Six is enough to show that the city has this place several times
 * over, and short enough that the list under the real results still reads as a
 * suggestion.
 *
 * It is a cap on this list alone and not a share of one total, because the two
 * lists answer different questions — "here it is" and "here is where it would
 * be". One budget over both would let eight loaded parks hide the café a person
 * typed the name of.
 */
export const SEARCH_INDEX_LIMIT = 6;

/**
 * The normalised text of every index row, in the row's own order.
 *
 * This exists for one measured reason. Normalising per keystroke costs ~50 ms
 * per query at 31,057 rows (measured for T-100 stage 2), which is a search box
 * that stutters on every letter. Folding once, when the array arrives, drops a
 * query to 0.5-3.3 ms — the whole scan, distances included.
 *
 * Fields are joined with a newline, and nothing can span the boundary:
 * `normaliseName` collapses every whitespace run to a single space, so no field
 * can contain a newline and no needle can either. "Cama" in the name and
 * "Coffee Street" in the address therefore never combine into a match for "cama
 * coffee".
 */
export type SearchHaystack = readonly string[];

/**
 * Keyed on the array itself, so the cache is exactly as long-lived as the index
 * it describes: the store writes `searchIndex` once and hands the same frozen
 * array to every render, and a `WeakMap` means the day it were replaced the old
 * haystack would be collectable rather than a leak keyed by a stale identity.
 *
 * Module-level rather than a `useMemo`, because the box unmounts and remounts
 * (React StrictMode does it twice on every mount in development) and rebuilding
 * 31,057 strings on each remount is 15 ms of nothing.
 */
const haystacks = new WeakMap<readonly SearchIndexEntry[], SearchHaystack>();

/** Folded once per index array; see {@link SearchHaystack}. */
export function searchHaystack(index: readonly SearchIndexEntry[]): SearchHaystack {
  const cached = haystacks.get(index);
  if (cached) return cached;
  const built = index.map((entry) => {
    let text = normaliseName(entry.name);
    if (entry.nameEn) text += `\n${normaliseName(entry.nameEn)}`;
    if (entry.brand) text += `\n${normaliseName(entry.brand)}`;
    if (entry.cuisine) text += `\n${normaliseName(entry.cuisine)}`;
    if (entry.address) text += `\n${normaliseName(entry.address)}`;
    return text;
  });
  haystacks.set(index, built);
  return built;
}

export interface IndexSearchInput {
  /** The citywide index, or null when this page does not have it. */
  index: readonly SearchIndexEntry[] | null;
  /** Raw, as typed. Folded here. */
  query: string;
  /** The visible rectangle, or null before the map has reported one. */
  bounds: Bounds | null;
  /** The camera centre: distances are from here, and so is the ranking. */
  origin: LngLat;
  /** Whatever categories are already in memory; their rows are left out. */
  loadedCategories: readonly Tier2Category[];
  limit?: number;
}

const EMPTY: IndexAnswer = { hits: [], total: 0, overflow: 0 };

function inside(bounds: Bounds | null, lng: number, lat: number): boolean {
  if (!bounds) return false;
  return lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

/**
 * What the whole city has for this query that the map is not holding.
 *
 * Ranked exactly like the loaded rows — on screen first, then nearest — so the
 * two lists read as one list with a line through it rather than as two orders a
 * person has to reconcile. Id last, so two runs over the same data never
 * disagree about which six were shown.
 *
 * A page with no index (never asked, still arriving, unreadable, not shipped)
 * gets an empty answer rather than an error: every consumer of this index
 * degrades by saying less. The *box* says which of those it is, because "still
 * loading" and "nothing in Taipei matches that" are different sentences.
 */
export function searchIndexEntries(input: IndexSearchInput): IndexAnswer {
  const needle = normaliseName(input.query);
  if (!needle || !input.index) return EMPTY;

  const haystack = searchHaystack(input.index);
  const loaded = new Set<string>(input.loadedCategories);
  const limit = input.limit ?? SEARCH_INDEX_LIMIT;
  const scored: IndexHit[] = [];

  for (let i = 0; i < input.index.length; i++) {
    if (!haystack[i].includes(needle)) continue;
    const entry = input.index[i];
    // Already searchable as a real feature above this list; see the header.
    if (entry.categories.some((c) => loaded.has(c))) continue;
    // A row this build has no tier-2 category for is a row a pick could not
    // load, so it is not offered. The index holds only tier-2 categories today
    // — this is what keeps the offer honest if it ever holds anything else.
    const category = entry.categories.find(isTier2Category);
    if (!category) continue;
    const center: LngLat = [entry.lng, entry.lat];
    scored.push({
      id: entry.id,
      name: entry.name,
      ...(entry.nameEn ? { nameEn: entry.nameEn } : {}),
      ...(entry.address ? { address: entry.address } : {}),
      category,
      what: TIER2_SINGULAR[category],
      center,
      distanceM: distanceMeters(input.origin, center),
      inView: inside(input.bounds, entry.lng, entry.lat),
    });
  }

  scored.sort(
    (a, b) =>
      Number(b.inView) - Number(a.inView) ||
      a.distanceM - b.distanceM ||
      a.id.localeCompare(b.id),
  );

  return {
    hits: scored.slice(0, limit),
    total: scored.length,
    overflow: Math.max(scored.length - limit, 0),
  };
}
