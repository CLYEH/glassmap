import { isFeatureCategory } from "@/lib/data/schema";
import { normaliseName } from "@/lib/map-tools/gazetteer";
import { distanceMeters, featureCenter } from "@/lib/map-tools/output";
import type { Bounds, LngLat } from "@/lib/store/map-store";
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
 * ## Why this is wider than the tools' `query`, and must stay wider
 *
 * `find_features` and `list_features_in_view` match the local and English
 * **name** only (`QUERY_MATCHING` in `map-tools/index.ts`, `matchesQuery` in
 * `map-tools/query.ts`). This box also matches `brand` and `cuisine`, and the
 * asymmetry is deliberate on both sides:
 *
 *  - **An agent already has a category.** It asks `list_features_in_view({
 *    categories: ["cafe"], query: "Louisa" })` — the category is the subject
 *    and the query narrows it by name. Widening the tool's `query` to tags
 *    would change what every answer it has ever given means: a `query` that
 *    silently matched `cuisine` would return places whose names an agent
 *    could not explain to the human it is talking to.
 *  - **A person has a word, not a category.** They type "coffee", "7-eleven",
 *    "vegetarian" — the word in their head, with no vocabulary to pick from
 *    and no tool call to make. Matching names only would answer "nothing
 *    here" over a map that is holding the answer.
 *
 * So: two matchers, one folding — `normaliseName` is shared, so spelling
 * ("Da-an" vs "Daan") decides the same way on both sides and only the *field
 * set* differs. Do not unify them in either direction.
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

/** Name, English name, brand, cuisine — see the header for why it is four. */
function matches(properties: MapFeatureProperties, needle: string): boolean {
  return (
    normaliseName(properties.name ?? "").includes(needle) ||
    normaliseName(properties.nameEn ?? "").includes(needle) ||
    normaliseName(properties.brand ?? "").includes(needle) ||
    normaliseName(properties.cuisine ?? "").includes(needle)
  );
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
      if (!matches(properties, needle)) continue;
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
