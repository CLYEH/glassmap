import { isFeatureCategory } from "@/lib/data/schema";
import { normaliseName } from "@/lib/map-tools/gazetteer";
import { distanceMeters, featureCenter } from "@/lib/map-tools/output";
import { matchesQuery } from "@/lib/map-tools/query";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import type { SearchIndexStatus } from "@/lib/store/search-index";
import {
  TIER2_CATEGORIES,
  type MapCategory,
  type MapFeature,
  type MapFeatureProperties,
  type Tier2Category,
} from "@/lib/store/tier2";
import { POI_SWATCH } from "./card-model";
import { categorySingular } from "./category-labels";
import { sameText } from "./feature-details";
import { CATEGORY_COLOR } from "./map-style";
import type { IndexHit } from "./search-index-model";
import type { CategoryRow } from "./search-vocabulary";

/**
 * The human search box's matcher, ranker and honesty line — everything the box
 * says, minus the box.
 *
 * It reads the store's loaded features directly and calls no tool. That is the
 * same law the browse tray works under (`browse-store.ts`): a person typing is
 * not an agent acting, so a keystroke must not wake the agent chrome, must not
 * write a row into the activity feed, and must not be visible through
 * `modelContext` at all. The one thing that crosses into the shared store is
 * what the person then *does* — the selection, written as `"user"`.
 *
 * ## One predicate, every surface (T-102)
 *
 * The matching is not this module's own: it is `matchesQuery` over
 * `QUERY_FIELDS` (`map-tools/query.ts`) — local name, English name, brand,
 * cuisine, address. The same function answers `find_features`,
 * `select_features` and `list_features_in_view`; the same five columns are what
 * the citywide list folds into its haystack (`search-index-model.ts`) and what
 * the tool layer's `unloadedMatches` counts. So a word that finds a place for a
 * person finds it for an agent, and the box's own two lists cannot disagree
 * about which places matched.
 *
 * It was not always so, and the history is the argument for keeping it this
 * way. Until T-102 the tools matched names only while this box matched four
 * fields, on the reasoning that an agent already has a category and narrows it
 * by name, whereas a person types the word in their head — "coffee",
 * "7-eleven", "vegetarian". What that reasoning could not explain was the
 * asymmetry *inside the box*: the citywide list read `address` and this one did
 * not, so typing a street name found a café the map had never fetched and
 * missed the identical one it was holding. The fix was to widen rather than
 * narrow, in both directions at once — the disclosed count is a promise about a
 * later call (`unloadedMatches`), so it can only count columns that call also
 * reads. One field set, or the count lies.
 *
 * ## What stays the box's alone
 *
 * The field set is shared; nothing else here is. Each of these answers a
 * question an agent does not ask, and unifying it would cost the human surface
 * without buying the tool one:
 *
 *  - **The vocabulary layer.** "咖啡", "ubike", "drugstore" name a *kind* of
 *    place, not a place, and `matchCategoryVocabulary` (`search-vocabulary.ts`)
 *    answers them with the offer to paint the whole category. An agent picks
 *    its category out of the tool schema's enum and needs no synonyms. That
 *    layer also matches by **prefix**, not substring — "咖" already offers cafés
 *    — which is a rule shaped by keystrokes and meaningless in one tool call.
 *  - **The ranking.** On screen first, then nearest (below), and every loaded
 *    row above every citywide one however far away (`composeSearchRows`). The
 *    tools sort by distance alone and let the caller decide.
 *  - **The caps.** Eight loaded rows, six citywide ones — a dropdown is read at
 *    a glance. A tool's `limit` defaults to 20 and reaches 100.
 *  - **Which list a place lands in.** The citywide list drops any row whose
 *    category is already in memory, so one place is never offered twice.
 *
 * ## `inView` is a ranking hint, not the tool's answer
 *
 * `list_features_in_view` calls a feature visible when its bounding box
 * overlaps the view — the honest test for "describe the screen". Here the
 * question is only which of two matches to show first, so it asks the cheaper
 * one: is the feature's centre inside `bounds`. One geometry pass per
 * keystroke instead of two, and the ordering a person reads is unchanged —
 * a district whose centre has scrolled off is still a match, just below the
 * cafe they can see.
 */

/** How many rows the dropdown shows before it starts counting instead. */
export const SEARCH_LIMIT = 8;

/**
 * Where the camera lands on a pick, when it is further out than this.
 *
 * The same number `set_map_view({ place })` uses (`PLACE_ZOOM`, map-tools/
 * index.ts) — restated rather than imported, because that module is the tool
 * registry and nothing on the human path may depend on it. A pick never zooms
 * *out*: a person who has framed a neighbourhood keeps their frame.
 *
 * **This is the point half of a two-branch rule, not the whole rule.** The
 * inspector's row click applies the same "never zoom out" law with an *area*
 * branch beside it (T-101's `frameFor`): a feature carrying a bounding box is
 * fitted to it, and only a point falls back to a zoom like this one. What the
 * dropdown has is a centre and nothing else — a loaded hit is reduced to
 * `featureCenter`, and a citywide index row holds only `lng`/`lat` by
 * construction (`store/search-index.ts`) — so the point rule is the only one it
 * is *able* to apply. Should index rows ever gain a bbox, the widening belongs
 * in that area branch; this constant is not a decision that areas are zoomed to
 * rather than fitted, and unifying the two on the strength of it would regress
 * the inspector.
 */
export const SEARCH_ZOOM = 15;

/** One row of the dropdown. */
export interface SearchHit {
  id: string;
  /** What the row is titled: the local name, or the best thing the data has. */
  name: string;
  /** The English name, when the data carries one that is not the title (T-96). */
  nameEn?: string;
  category: MapCategory;
  /** The category in words, under/beside the name. */
  what: string;
  /** The dot's colour: the map's own ramp, or the POI grey the card uses. */
  swatch: string;
  /** Where a pick flies to. */
  center: LngLat;
  /** Metres from the view centre — the same measure the tools report. */
  distanceM: number;
  /** Whether this one is on screen right now; it is the first sort key. */
  inView: boolean;
}

export interface SearchAnswer {
  /** The capped rows, best first. Always empty for an empty query. */
  hits: SearchHit[];
  /** How many matched in all — what `overflow` is measured against. */
  total: number;
  /** Matches the cap left out: `total - hits.length`. */
  overflow: number;
  /**
   * How many point-of-interest categories are not loaded, and so were not
   * searched. The box says this out loud when nothing matched, for the reason
   * the tools do: "no cafes here" and "the cafe file was never fetched" must
   * never look the same. It never triggers a fetch — loading a category is a
   * deliberate act, from the Places tray or from an agent.
   */
  unfetchedCategories: number;
}

export interface SearchInput {
  /** The six bundled datasets. */
  features: readonly MapFeature[];
  /** Whatever point-of-interest categories have been fetched this session. */
  tier2Features: readonly MapFeature[];
  /** Raw, as typed. Trimmed and folded here. */
  query: string;
  /** The visible rectangle, or null before the map has reported one. */
  bounds: Bounds | null;
  /** The camera centre: distances are from here, and so is the ranking. */
  origin: LngLat;
  loadedCategories: readonly Tier2Category[];
  limit?: number;
}

/**
 * A place that carries no `name` is normal in the POI extract — a nameless car
 * park is still somewhere to park — and one of them can be matched by its brand
 * or its cuisine. Same fallback order the sidebar uses (`selection-model`),
 * with `brand` added because that is the word that found it.
 */
function title(properties: MapFeatureProperties): string {
  return properties.name || properties.nameEn || properties.brand || properties.id;
}

function inside(bounds: Bounds | null, center: LngLat): boolean {
  if (!bounds) return false;
  const [west, south, east, north] = bounds;
  return center[0] >= west && center[0] <= east && center[1] >= south && center[1] <= north;
}

/**
 * The whole answer for one query, over what the store is holding.
 *
 * An empty (or all-whitespace) query is not a search: it returns no rows at
 * all, which is what keeps the dropdown shut on a box a person has merely
 * focused. `unfetchedCategories` is still reported, because it is a fact about
 * the map rather than about the query.
 *
 * Bundled features are collected before point-of-interest ones so a shared id
 * resolves to the painted feature — the same precedence `resolveSelection` and
 * the store's own append apply.
 */
export function searchLoadedFeatures(input: SearchInput): SearchAnswer {
  const loaded = new Set(input.loadedCategories);
  const unfetchedCategories = TIER2_CATEGORIES.filter((c) => !loaded.has(c)).length;
  const needle = normaliseName(input.query);
  if (!needle) return { hits: [], total: 0, overflow: 0, unfetchedCategories };

  const limit = input.limit ?? SEARCH_LIMIT;
  const seen = new Set<string>();
  const scored: SearchHit[] = [];

  const collect = (list: readonly MapFeature[]) => {
    for (const feature of list) {
      const properties = feature?.properties;
      if (!properties?.id || seen.has(properties.id)) continue;
      // The tools' own predicate, over the tools' own five fields; see the
      // header. `MapFeatureProperties` carries every one of them, so it is
      // passed in whole exactly as `queryFeatures` passes it.
      if (!matchesQuery(properties, needle)) continue;
      seen.add(properties.id);
      // A place the box cannot fly to is not offered: every row's job is to
      // put the camera somewhere, and a broken geometry has nowhere.
      const center = featureCenter(feature);
      if (!center) continue;
      const name = title(properties);
      const nameEn = properties.nameEn;
      scored.push({
        id: properties.id,
        name,
        ...(nameEn && !sameText(nameEn, name) ? { nameEn } : {}),
        category: properties.category,
        what: categorySingular(properties.category),
        swatch: isFeatureCategory(properties.category)
          ? CATEGORY_COLOR[properties.category]
          : POI_SWATCH,
        center,
        distanceM: distanceMeters(input.origin, center),
        inView: inside(input.bounds, center),
      });
    }
  };
  collect(input.features);
  collect(input.tier2Features);

  // What you can see, nearest first; then everything else, nearest first. Id
  // last so two runs over the same data never disagree.
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
    unfetchedCategories,
  };
}

/**
 * Metres as a person reads them: exact under a kilometre, one decimal above.
 * Rounded rather than truncated — a row is a sense of how far, and the exact
 * figure is the one the tools return.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * One row of the dropdown, whichever of the three answers it is.
 *
 * `key` is unique across the three kinds, so a place that is both a loaded
 * feature and an index row (it cannot be today — see `searchIndexEntries` — but
 * the union does not depend on that) still gets two distinct React keys, and so
 * a test can address any row by one string.
 */
export type SearchRow =
  | { kind: "loaded"; key: string; hit: SearchHit }
  | { kind: "index"; key: string; hit: IndexHit }
  | { kind: "category"; key: string; row: CategoryRow };

/**
 * The one order the dropdown is read in: what the map is holding, then what the
 * city has, then what kind of place the words might have meant.
 *
 * The precedence is absolute and not a score. A loaded feature outranks every
 * index row however far away it is, because it is the stronger answer in every
 * respect a person can act on: it is already on the map, it can be selected and
 * inspected, its tags are real, and picking it costs nothing. An index row is a
 * promise that requires a download to keep. Ranking them together by distance
 * would put a café 200 m away that this page cannot show above one 400 m away
 * that it can — and the nearer row would be the one that makes the person wait.
 *
 * Category rows go last for the same reason read the other way: "browse every
 * café in Taipei" is the broadest possible answer to a query, so it belongs
 * under every specific one. It is an offer, not a result.
 */
export function composeSearchRows(
  loaded: readonly SearchHit[],
  index: readonly IndexHit[],
  categories: readonly CategoryRow[],
): SearchRow[] {
  return [
    ...loaded.map((hit): SearchRow => ({ kind: "loaded", key: `loaded:${hit.id}`, hit })),
    ...index.map((hit): SearchRow => ({ kind: "index", key: `index:${hit.id}`, hit })),
    ...categories.map((row): SearchRow => ({ kind: "category", key: `cat:${row.category}`, row })),
  ];
}

/**
 * What the box says when all three lists came back empty — one sentence per
 * thing that can actually be true.
 *
 * This is the honesty the tools have had since tier-2 shipped, on the human
 * surface: "nothing matches" and "the file was never fetched" must never look
 * the same. The citywide index makes one of these sentences newly *strong* —
 * with the index in hand, a miss really is a miss across all 31,057 points of
 * interest, and the box may finally say so about the city rather than about its
 * own memory. Without it, the honest answer is still the narrow one.
 *
 * Five states, five sentences, because each one changes what a person should do
 * next: wait, give up, try a different word, keep typing (the retry), or open
 * the tray.
 */
export function searchEmptyNote(
  status: SearchIndexStatus,
  unfetchedCategories: number,
): string {
  if (status === "loading") return "Still looking through the rest of Taipei…";
  if (status === "ready") return "Nothing in Taipei matches that.";
  if (status === "failed") {
    return "Nothing loaded matches that — the citywide index did not arrive. Keep typing to try again.";
  }
  // `idle` (nobody has asked yet) and `absent` (this build ships no index): the
  // box can only speak for what it has, so it points at the one thing that
  // would widen the search, exactly as it did before T-100.
  return unfetchedCategories > 0
    ? `Nothing loaded matches that — ${unfetchedCategories} more kinds of place load from the Places tray.`
    : "Nothing on this map matches that.";
}
