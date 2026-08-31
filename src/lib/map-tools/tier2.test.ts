/**
 * Category-lazy tier-2, seen from the tools.
 *
 * The contract these tests defend, in the order it matters:
 *  1. a page that never mentions a point-of-interest category behaves exactly
 *     as it did before tier-2 existed — same fields, same bytes;
 *  2. naming a category is what loads it, city-wide, and the answer covers the
 *     whole city rather than the camera;
 *  3. a query with no category admits what it did not search;
 *  4. what is in memory depends on the categories that were asked for and
 *     nothing else — not on the order, not on the viewport;
 *  5. a file that does not arrive is an error with the category in it, never an
 *     empty result.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { createMemoryToolStore, type MemoryToolStoreInit } from "@/lib/store/map-store";
import { TIER2_CATEGORIES, TIER2_INDEX_URL } from "@/lib/store/tier2";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { FeatureOutput } from "./output";
import type { MapStateOutput } from "./state";
import { SELECT_MATCH_LIMIT, type UnsearchedCategory } from "./tier2-query";
import {
  createFlakyTier2Fetch,
  createTier2Fetch,
  FIXTURE_FEATURES,
  TIER2_CONVENIENCE_COUNT,
  TIER2_FILES,
  TIER2_FILES_WITH_BAKERY,
  TIER2_INDEX,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  total?: number;
  returned?: number;
  matched?: number;
  features?: FeatureOutput[];
  selected?: FeatureOutput[];
  candidates?: { id: string }[];
  category_counts?: Record<string, number>;
  searched_categories?: string[];
  unsearched_categories?: UnsearchedCategory[];
  state?: MapStateOutput;
  tier2?: MapStateOutput["tier2"];
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const idsOf = (features: FeatureOutput[] | undefined) => (features ?? []).map((f) => f.id);

/** The Taipei fixture on a page whose POI files exist but are untouched. */
function tier2Ready(over: MemoryToolStoreInit = {}, files = TIER2_FILES, index: unknown = TIER2_INDEX) {
  const { fetchJson, requests } = createTier2Fetch(files, index);
  const store = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    tier2FetchJson: fetchJson,
    ...over,
  });
  const tools = createMapTools(store);
  return { store, requests, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

/** The same fixture on a page with no POI data at all: today's app. */
function noTier2(over: MemoryToolStoreInit = {}) {
  const store = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    ...over,
  });
  const tools = createMapTools(store);
  return { store, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

const categoryFiles = (requests: string[]) => requests.filter((u) => u !== TIER2_INDEX_URL);

describe("a page that never mentions a POI category", () => {
  /**
   * The shapes below are the shapes these tools returned before tier-2 existed.
   * Written out rather than snapshotted so that adding a field to any of them
   * is a decision someone has to make here, in this list, on purpose.
   */
  const BEFORE_TIER2_KEYS: Record<string, string[]> = {
    get_map_state: [
      "center",
      "zoom",
      "bearing",
      "pitch",
      "bounds",
      "selection",
      "features_loaded",
      "drawings",
      "annotations",
    ],
    // The deliberate decision this list exists to force: both search tools now
    // echo the origin their distances were measured from, exactly as
    // describe_surroundings always has. It is not a tier-2 field — it appears
    // on a page that never touches a POI category, which is why it belongs in
    // this list rather than in the disclosure ones below.
    list_features_in_view: ["total", "returned", "features", "origin"],
    find_features: ["total", "returned", "features", "origin"],
    describe_surroundings: ["origin", "district", "total", "returned", "groups"],
    compare_areas: ["a", "b", "radius_m", "summary"],
    select_features: ["selected", "unknown_ids", "unknown_count", "state"],
  };

  const INPUTS: Record<string, Record<string, unknown>> = {
    get_map_state: {},
    list_features_in_view: {},
    find_features: {},
    describe_surroundings: {},
    compare_areas: { a: "Daan Station", b: "Taipei main station" },
    select_features: { query: "Pxmart" },
  };

  it("answers with exactly the fields it answered with before", async () => {
    const { byName } = noTier2();
    for (const [tool, keys] of Object.entries(BEFORE_TIER2_KEYS)) {
      const out = await call(byName[tool], INPUTS[tool]);
      expect(Object.keys(out), tool).toEqual(keys);
    }
  });

  it("says nothing about tier-2 in map state, because there is nothing to say", async () => {
    const { byName } = noTier2();
    const state = await call(byName.get_map_state);
    expect(state.tier2).toBeUndefined();
    expect(state.features_loaded).toBe(FIXTURE_FEATURES.length);
  });

  it("makes no request at all until a tool needs one", async () => {
    // The lazy part of category-lazy: loading the page costs nothing extra.
    const { byName, requests } = tier2Ready();
    await call(byName.get_map_state);
    await call(byName.measure, { target: "osm:way:10" });
    await call(byName.draw_shape, { type: "circle", center: "Daan Station", radius_m: 300 });
    expect(requests).toEqual([]);
  });

  it("reads the index but no category file when the query names none", async () => {
    // A bare query has to know what it skipped; that costs one small file, and
    // never a category's features.
    const { byName, requests } = tier2Ready();
    await call(byName.find_features, { query: "park" });
    expect(categoryFiles(requests)).toEqual([]);
    expect(requests).toContain(TIER2_INDEX_URL);
  });
});

describe("naming a category loads it, city-wide", () => {
  it("answers about the whole city, not the viewport", async () => {
    // 小林咖啡 is across town and outside VIEW_BOUNDS. A camera-driven loader
    // would never have it; find_features has to.
    const { byName, requests, store } = tier2Ready();
    const out = await call(byName.find_features, { categories: ["cafe"] });

    expect(idsOf(out.features)).toEqual(["osm:node:101", "osm:node:100", "osm:node:102"]);
    expect(categoryFiles(requests)).toEqual(["/data/tier2/cafe.geojson"]);
    expect(store.getLoadedCategories()).toEqual(["cafe"]);
  });

  it("loads the same features whatever the camera is looking at", async () => {
    // Store contents are a function of the requested categories and nothing
    // else. If they followed the camera, the same question asked twice would
    // get two answers and the agent could not see why.
    const here = tier2Ready();
    const elsewhere = tier2Ready({ view: { ...VIEW, center: [121.44, 25.12] }, bounds: null });
    const a = await call(here.byName.find_features, { categories: ["cafe"] });
    const b = await call(elsewhere.byName.find_features, { categories: ["cafe"] });
    expect(idsOf(a.features).sort()).toEqual(idsOf(b.features).sort());
    expect(a.total).toBe(b.total);
  });

  it("keeps list_features_in_view about what is on screen", async () => {
    // Loading is city-wide; the answer this tool gives is not. 小林咖啡 is
    // loaded and outside the viewport, so it must not appear here.
    const { byName } = tier2Ready();
    const out = await call(byName.list_features_in_view, { categories: ["cafe"] });
    expect(idsOf(out.features)).toEqual(["osm:node:101", "osm:node:100"]);
    expect(out.total).toBe(2);
  });

  it("loads for select_features, describe_surroundings and compare_areas too", async () => {
    const select = tier2Ready();
    const selected = await call(select.byName.select_features, { categories: ["restaurant"] });
    expect(idsOf(selected.selected).sort()).toEqual([
      "osm:node:110",
      "osm:node:111",
      "osm:node:112",
    ]);
    expect(selected.state?.tier2).toEqual({ loaded: ["restaurant"], available: 4 });

    const around = tier2Ready();
    const surroundings = await call(around.byName.describe_surroundings, {
      from: "Daan Station",
      radius_m: 500,
      categories: ["cafe"],
    });
    expect(JSON.stringify(surroundings.groups)).toMatch(/osm:node:100/);

    const compare = tier2Ready();
    const compared = await call(compare.byName.compare_areas, {
      a: "Daan Station",
      b: "Taipei main station",
      categories: ["cafe", "restaurant"],
    });
    // b is Taipei Main, 3 km away: 小林咖啡 is the one POI within its 800 m.
    expect(compared.summary).toEqual(["cafe: a 2 vs b 1", "restaurant: a 3 vs b 0"]);
  });

  it("resolves a POI name in `near` because the category loads first", async () => {
    // {near: "小林咖啡", categories: ["cafe"]} must work in one call: the
    // origin the agent named is in the file the same call is fetching.
    const { byName } = tier2Ready();
    const out = await call(byName.find_features, { near: "小林咖啡", categories: ["cafe"] });
    expect(out.features?.[0]).toMatchObject({ id: "osm:node:102", distance_m: 0 });
  });

  it("returns the tags that make a POI worth fetching, and nothing else", async () => {
    // "A cafe" does not answer "somewhere open, with a brand I recognise".
    // Geometry still never leaves this layer.
    const { byName } = tier2Ready();
    const out = await call(byName.find_features, { categories: ["cafe"], query: "Louisa" });
    expect(out.features?.[0]).toMatchObject({
      id: "osm:node:100",
      name: "路易莎咖啡",
      name_en: "Louisa Coffee",
      category: "cafe",
      brand: "Louisa Coffee",
      opening_hours: "Mo-Su 07:00-22:00",
    });
    expect(Object.keys(out.features?.[0] ?? {}).sort()).toEqual([
      "brand",
      "category",
      "direction",
      "distance_m",
      "id",
      "name",
      "name_en",
      "opening_hours",
    ]);
  });

  it("finds a double-tagged POI under either of its categories", async () => {
    /*
     * 12 ids in the shipped extract appear in two category files
     * (public/data/README.md: a bakery that is also a fast-food counter, each
     * file generated from its own tag query). Ids have to stay unique, so
     * the store merges them — and then a query for the *second* category has to
     * find it, whichever file arrived first. Without this, the answer to "any
     * bakeries?" would depend on what the human asked about ten minutes ago.
     */
    const forward = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    await call(forward.byName.find_features, { categories: ["restaurant"] });
    const asBakery = await call(forward.byName.find_features, { categories: ["bakery"] });

    const backward = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    await call(backward.byName.find_features, { categories: ["bakery"] });
    const asRestaurant = await call(backward.byName.find_features, { categories: ["restaurant"] });

    expect(idsOf(asBakery.features)).toEqual(["osm:node:112"]);
    expect(idsOf(asRestaurant.features)).toContain("osm:node:112");
    // One feature, one id, both categories named so the agent can explain why a
    // "bakery" search returned something the map calls a restaurant.
    expect(forward.store.getFeatures().filter((f) => f.properties.id === "osm:node:112")).toHaveLength(1);
    expect(asBakery.features?.[0].categories).toEqual(["bakery", "restaurant"]);
    expect(forward.store.getFeatures().length).toBe(backward.store.getFeatures().length);
  });

  it("does not re-fetch a category for the next question", async () => {
    const { byName, requests } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    await call(byName.select_features, { categories: ["cafe"] });
    await call(byName.list_features_in_view, { categories: ["cafe", "cafe"] });
    expect(categoryFiles(requests)).toEqual(["/data/tier2/cafe.geojson"]);
  });
});

describe("the answer is the same whatever order categories were loaded in", () => {
  /*
   * Every fixture in this block serves the bakery file as well, so 多那之
   * (osm:node:112, in both the restaurant and the bakery file) is loaded twice
   * under one id. That feature is the only place where load order can survive
   * into an answer - it is the one row the store has to merge - so an
   * order-invariance test that leaves it out cannot fail for the reason it
   * exists. The two orders below differ in exactly that: which of its two files
   * arrives first.
   */
  it("gives one answer for two load orders", async () => {
    const forward = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    await call(forward.byName.find_features, { categories: ["cafe"] });
    await call(forward.byName.find_features, { categories: ["restaurant"] });
    await call(forward.byName.find_features, { categories: ["bakery"] });

    const backward = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    await call(backward.byName.find_features, { categories: ["bakery"] });
    await call(backward.byName.find_features, { categories: ["restaurant"] });
    await call(backward.byName.find_features, { categories: ["cafe"] });

    const question = { near: "Daan Station", radius_m: 1000 };
    expect(await call(forward.byName.find_features, question)).toEqual(
      await call(backward.byName.find_features, question),
    );
    expect(await call(forward.byName.get_map_state)).toEqual(
      await call(backward.byName.get_map_state),
    );
    // category_counts is where a first-file-wins merge shows up loudest: the
    // same shop would be counted as a restaurant in one session and a bakery in
    // the other, and the human reading the sidebar would see a different map.
    expect(await call(forward.byName.list_features_in_view)).toEqual(
      await call(backward.byName.list_features_in_view),
    );
  });

  it("gives one answer for two orders inside a single call", async () => {
    const a = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    const b = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    expect(
      await call(a.byName.find_features, { categories: ["bakery", "restaurant"] }),
    ).toEqual(await call(b.byName.find_features, { categories: ["restaurant", "bakery"] }));
    expect(a.store.getLoadedCategories()).toEqual(b.store.getLoadedCategories());
  });
});

describe("a query with no category says what it did not search", () => {
  const CITYWIDE: UnsearchedCategory[] = [
    { category: "bakery", citywide_count: 1 },
    { category: "cafe", citywide_count: 3 },
    { category: "convenience", citywide_count: TIER2_CONVENIENCE_COUNT },
    { category: "restaurant", citywide_count: 3 },
  ];

  it("lists every unloaded category with its citywide count", async () => {
    // The counts come from the index, so honesty costs one small file rather
    // than the features themselves.
    const { byName } = tier2Ready();
    const out = await call(byName.find_features, { query: "大安" });
    expect(out.unsearched_categories).toEqual(CITYWIDE);
    expect(out.searched_categories).toEqual([
      "mrt_station",
      "park",
      "school",
      "supermarket",
      "listing",
      "district",
    ]);
  });

  it("moves a category from unsearched to searched once it is loaded", async () => {
    const { byName } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    const out = await call(byName.find_features, { query: "大安" });

    expect(out.searched_categories).toContain("cafe");
    expect(out.unsearched_categories?.map((c) => c.category)).toEqual([
      "bakery",
      "convenience",
      "restaurant",
    ]);
    // And the bare query really did search the loaded cafes.
    expect(idsOf(out.features)).toContain("osm:node:101");
  });

  it("says nothing when the caller named the categories", async () => {
    // The agent that asked for cafes knows it asked for cafes; repeating the
    // other 17 on every call would be noise, not honesty.
    const { byName } = tier2Ready();
    const out = await call(byName.find_features, { categories: ["cafe"] });
    expect(out.unsearched_categories).toBeUndefined();
    expect(out.searched_categories).toBeUndefined();
  });

  it("discloses on every tool that can answer without a category", async () => {
    const { byName } = tier2Ready();
    const bare = [
      await call(byName.list_features_in_view),
      await call(byName.find_features),
      await call(byName.describe_surroundings, { from: "Daan Station" }),
      await call(byName.compare_areas, { a: "Daan Station", b: "Taipei main station" }),
      await call(byName.select_features, { query: "Pxmart" }),
    ];
    for (const out of bare) expect(out.unsearched_categories).toEqual(CITYWIDE);
  });

  it("tells list_features_in_view what is on screen, by category", async () => {
    // "What am I looking at?" in one call instead of one call per category.
    const { byName } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    const out = await call(byName.list_features_in_view);

    expect(out.category_counts).toEqual({
      listing: 1,
      mrt_station: 2,
      park: 1,
      supermarket: 1,
      district: 1,
      cafe: 2,
    });
    // In-view counts and citywide counts are different numbers and are labelled
    // as such: 3 cafes exist, 2 are on screen.
    expect(out.category_counts?.cafe).toBe(2);
    expect(TIER2_INDEX.categories.find((c) => c.category === "cafe")?.count).toBe(3);
  });

  it("counts loaded POIs in a bare describe_surroundings and compare_areas", async () => {
    const { byName } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });

    const around = await call(byName.describe_surroundings, { from: "Daan Station" });
    expect(JSON.stringify(around.groups)).toMatch(/osm:node:100/);

    const compared = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Taipei main station",
    });
    expect(compared.summary).toContain("cafe: a 2 vs b 1");
  });

  it("admits what a place lookup could not have found", async () => {
    // set_map_view cannot fetch 18 files to check one word, so "unknown place"
    // has to mean "unknown among the categories I have".
    const { byName, store } = tier2Ready();
    const out = await call(byName.set_map_view, { place: "小林咖啡" });
    expect(out.error).toBe("unknown place");
    expect(out.unsearched_categories).toEqual(CITYWIDE);
    expect(store.getView().center).toEqual(VIEW.center);
  });
});

describe("selecting a citywide category", () => {
  /** Bundled features, in any number: the cap is not about these. */
  const parks = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      type: "Feature" as const,
      properties: {
        id: `osm:way:${5000 + i}`,
        name: `公園 ${i}`,
        category: "park" as const,
        source: "osm" as const,
      },
      geometry: { type: "Point" as const, coordinates: [121.53 + i / 100000, 25.03] },
    }));

  it("refuses rather than highlighting the whole city, and says how many", async () => {
    const { byName, store } = tier2Ready({ selection: ["osm:way:10"] });
    const out = await call(byName.select_features, { categories: ["convenience"] });

    expect(out.error).toMatch(String(TIER2_CONVENIENCE_COUNT));
    expect(out.error).toMatch(String(SELECT_MATCH_LIMIT));
    expect(out.error).toMatch(/near|radius_m|within|query/);
    expect(out.matched).toBe(TIER2_CONVENIENCE_COUNT);
    // Refused means nothing happened: the previous selection is intact.
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("accepts the same category once the filter is narrowed", async () => {
    // The error names the way out; this proves the way out works.
    const { byName, store } = tier2Ready();
    const out = await call(byName.select_features, {
      categories: ["convenience"],
      near: { lng: 121.535, lat: 25.032 },
      radius_m: 300,
    });
    expect(out.error).toBeUndefined();
    expect(store.getSelection().length).toBeGreaterThan(0);
    expect(store.getSelection().length).toBeLessThanOrEqual(SELECT_MATCH_LIMIT);
  });

  it("leaves selections over the bundled datasets uncapped", async () => {
    // The six datasets are small and bounded, and "select every match" has been
    // their contract since the tool shipped. The cap exists for citywide POI
    // files, so it must not quietly change what a park query does.
    const { byName, store } = tier2Ready({ features: parks(SELECT_MATCH_LIMIT + 100) });

    const out = await call(byName.select_features, { categories: ["park"] });
    expect(out.error).toBeUndefined();
    expect(store.getSelection()).toHaveLength(SELECT_MATCH_LIMIT + 100);
  });

  it("does not let uncapped bundled matches refuse a mixed filter", async () => {
    // 600 parks plus 3 cafes: 603 matches, 3 of them points of interest. Arming
    // the cap on the size of the whole match set refuses this with a sentence
    // about point-of-interest features the agent cannot act on - the parks were
    // never the problem, and no narrowing of the POI side would have helped.
    const { byName, store } = tier2Ready({ features: parks(600) });

    const out = await call(byName.select_features, { categories: ["park", "cafe"] });

    expect(out.error).toBeUndefined();
    expect(store.getSelection()).toHaveLength(603);
  });

  it("still refuses when the points of interest alone are over the cap", async () => {
    // The mirror image: 600 convenience stores plus 3 parks. The refusal names
    // the 600 that caused it, not the 603 that did not, so "narrow it" is
    // advice the agent can follow.
    const { byName, store } = tier2Ready({ features: parks(3), selection: ["osm:way:5000"] });

    const out = await call(byName.select_features, { categories: ["convenience", "park"] });

    expect(out.error).toMatch(String(TIER2_CONVENIENCE_COUNT));
    expect(out.error).toMatch(String(SELECT_MATCH_LIMIT));
    expect(out.matched).toBe(TIER2_CONVENIENCE_COUNT + 3);
    expect(store.getSelection()).toEqual(["osm:way:5000"]);
  });
});

describe("loaded POI names become places", () => {
  it("resolves a POI name once its category is in memory, and not before", async () => {
    const { byName, store } = tier2Ready();
    expect((await call(byName.set_map_view, { place: "小林咖啡" })).error).toBe("unknown place");

    await call(byName.find_features, { categories: ["cafe"] });
    const out = await call(byName.set_map_view, { place: "小林咖啡" });

    expect(out.error).toBeUndefined();
    expect(store.getView().center).toEqual([121.512, 25.0505]);
  });

  it("asks instead of guessing when a POI shares a name with a station", async () => {
    /*
     * The measured citywide risk of loading POI names into the gazetteer is
     * about one collision — this fixture is that collision: a cafe called 大安
     * and the MRT station 大安. Both are exact matches, so the ranking rules
     * make it ambiguous, and an ambiguous place must never move the map: an
     * agent cannot see that it flew to a coffee shop instead of a station.
     */
    const { byName, store } = tier2Ready();
    expect((await call(byName.set_map_view, { place: "大安" })).error).toBeUndefined();
    expect(store.getView().center).toEqual([121.5436, 25.0334]);

    const after = tier2Ready();
    await call(after.byName.find_features, { categories: ["cafe"] });
    const out = await call(after.byName.set_map_view, { place: "大安" });

    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:101", "osm:node:2"]);
    expect(after.store.getView().center).toEqual(VIEW.center);
  });

  it("keeps exact-match ranking: a longer name is not beaten by a substring", async () => {
    const { byName, store } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe", "restaurant"] });
    const out = await call(byName.set_map_view, { place: "鼎泰豐" });
    expect(out.error).toBeUndefined();
    expect(store.getView().center).toEqual([121.5361, 25.0331]);
  });
});

describe("a category that will not load", () => {
  it("fails with the category in the message instead of answering nothing", async () => {
    // The index lists a bakery file and this server does not serve it.
    // "0 bakeries" would be a confident, wrong answer about a city full of them.
    const { byName } = tier2Ready();
    const out = await call(byName.find_features, { categories: ["bakery"] });
    expect(out.error).toMatch(/bakery/);
    expect(out.error).toMatch(/404/);
    expect(out.features).toBeUndefined();
  });

  it("fails the whole call rather than answering about the categories that worked", async () => {
    // A partial answer has no visible edge: the agent would report the cafes it
    // got and never mention the bakeries it did not.
    const { byName, store } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    const out = await call(byName.find_features, { categories: ["cafe", "bakery"] });

    expect(out.error).toMatch(/bakery/);
    expect(out.total).toBeUndefined();
    expect(out.features).toBeUndefined();
    // What was already in memory stays: a failed call is refused, not undone.
    expect(store.getLoadedCategories()).toEqual(["cafe"]);
  });

  it("says so on a write tool too, and leaves the map alone", async () => {
    const { byName, store } = tier2Ready({ selection: ["osm:node:2"] });
    const out = await call(byName.select_features, { categories: ["bakery"] });
    expect(out.error).toMatch(/bakery/);
    expect(store.getSelection()).toEqual(["osm:node:2"]);
    expect(out.state?.selection.ids).toEqual(["osm:node:2"]);
  });

  it("names the index when the index is what is missing", async () => {
    const { byName } = tier2Ready({}, TIER2_FILES, null);
    const out = await call(byName.find_features, { categories: ["cafe"] });
    expect(out.error).toMatch(/cafe/);
    expect(out.error).toMatch(TIER2_INDEX_URL);
  });

  it("keeps a bare query working when there is no index at all", async () => {
    // No index means no tier-2 data: exactly today's app, which must not start
    // failing because a file it never had is still not there.
    const { byName } = tier2Ready({}, TIER2_FILES, null);
    const out = await call(byName.find_features, { query: "大安" });
    expect(out.error).toBeUndefined();
    // Still the pre-tier-2 answer plus the origin echo every search now carries
    // — and still nothing about categories, which is what this test is for: a
    // missing index must not add a disclosure field to the result.
    expect(Object.keys(out)).toEqual(["total", "returned", "features", "origin"]);
  });

  it("asks for a missing index once, however long the conversation is", async () => {
    // Every bare query calls for the index to know what it skipped, and on a
    // page with no tier-2 files it will never be there: five questions were
    // five 404s. "This deployment has no POI data" is an answer, and answers
    // are remembered.
    const { byName, requests } = tier2Ready({}, TIER2_FILES, null);

    for (let i = 0; i < 5; i++) {
      expect((await call(byName.find_features, { query: "大安" })).error, `query ${i}`).toBeUndefined();
    }

    expect(requests).toEqual([TIER2_INDEX_URL]);
  });
});

describe("map state after a load", () => {
  it("counts POIs in features_loaded and names the loaded categories", async () => {
    const { byName } = tier2Ready();
    const before = await call(byName.get_map_state);
    expect(before.features_loaded).toBe(FIXTURE_FEATURES.length);

    await call(byName.find_features, { categories: ["cafe"] });
    const after = await call(byName.get_map_state);

    expect(after.features_loaded).toBe(FIXTURE_FEATURES.length + 3);
    expect(after.tier2).toEqual({ loaded: ["cafe"], available: 4 });
  });

  it("stops reporting a category as failed once a query has loaded it", async () => {
    // Reproduced on the live page: a link's cafe file caught a 503, the human
    // then asked for cafes and got every one of them, and the state each tool
    // returns went on carrying "could not load cafe" beside a tier2.loaded that
    // said cafe. An agent reading that object has to choose which half of it to
    // believe, and it is the wrong half it reads out to the human - over a map
    // that is showing the cafes it is apologising for.
    const { byName, store } = tier2Ready({
      tier2FetchJson: createFlakyTier2Fetch("cafe", 1).fetchJson,
    });
    expect((await store.restoreCategories(["cafe"])).ok, "the 503 restore").toBe(false);
    const failed = await call(byName.get_map_state);
    expect(failed.tier2?.failed?.map((f) => f.category)).toEqual(["cafe"]);

    expect((await call(byName.find_features, { categories: ["cafe"] })).error).toBeUndefined();

    const after = await call(byName.get_map_state);
    expect(after.tier2).toEqual({ loaded: ["cafe"], available: 4 });
  });

  it("never fetches anything to describe itself", async () => {
    // Every write tool returns map state. If describing the map cost a request,
    // tier-2 would be something a page pays for without ever asking for it.
    const { byName, requests } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    const before = requests.length;
    await call(byName.get_map_state);
    await call(byName.annotate, { at: "Daan Station", note: "here" });
    expect(requests).toHaveLength(before);
  });

  it("is the same state whichever tool returned it", async () => {
    const { byName } = tier2Ready();
    await call(byName.find_features, { categories: ["cafe"] });
    const fromWrite = await call(byName.select_features, { ids: ["osm:node:100"] });
    const fromRead = await call(byName.get_map_state);
    expect(fromWrite.state?.tier2).toEqual(fromRead.tier2);
  });
});

describe("what the agent is told about categories", () => {
  it("offers all 24 category names and explains how loading works", async () => {
    const { byName } = tier2Ready();
    const schema = byName.find_features.inputSchema as {
      properties: { categories: { items: { enum: string[] }; description: string } };
    };
    const { description } = schema.properties.categories;

    expect(schema.properties.categories.items.enum).toEqual([
      "mrt_station",
      "park",
      "school",
      "supermarket",
      "listing",
      "district",
      ...TIER2_CATEGORIES,
    ]);
    // The old copy promised something that is no longer true.
    expect(description).not.toMatch(/Omit to search every category/);
    expect(description).toMatch(/unsearched_categories/);
    expect(description).toMatch(/whole city/i);
  });

  it("gives each tool exactly one rule for omitting categories", async () => {
    // describe_surroundings carried two: its own ("omit for the neighbour
    // categories") and the shared one ("omit and the search covers the
    // always-in-memory categories"). They disagree about what happens, and an
    // agent reading a schema has nothing else to check it against - it cannot
    // try the call and look at the map.
    const { byName } = tier2Ready();
    for (const name of [
      "find_features",
      "list_features_in_view",
      "select_features",
      "describe_surroundings",
      "compare_areas",
    ]) {
      const schema = byName[name].inputSchema as {
        properties: { categories?: { description?: string } };
      };
      const description = schema.properties.categories?.description ?? "";
      expect(description.match(/\bOmit\b/g) ?? [], name).toHaveLength(1);
      // Every one of them still explains loading: it is the half no tool can
      // assume the agent already read somewhere else.
      expect(description, name).toMatch(/whole city/i);
    }
  });

  it("says that a double-tagged POI is counted under each of its categories", async () => {
    // 多那之 is a restaurant and a bakery, so compare_areas counts it twice and
    // by_category sums to more than total. Undisclosed, that reads as a bug: an
    // agent would either report it or "correct" the numbers it reads out.
    const { byName } = tier2Ready({}, TIER2_FILES_WITH_BAKERY);
    const out = await call(byName.compare_areas, {
      a: "Daan Station",
      b: "Taipei main station",
      categories: ["bakery", "restaurant"],
    });

    const a = out.a as { total: number; by_category: Record<string, { count: number }> };
    const summed = Object.values(a.by_category).reduce((n, c) => n + c.count, 0);
    expect(summed).toBeGreaterThan(a.total);
    expect(byName.compare_areas.description).toMatch(/more than total/);
  });

  it("still marks POI answers as untrusted content", async () => {
    // POI names are OSM text like every other name on this map.
    const { byName } = tier2Ready();
    for (const name of [
      "get_map_state",
      "find_features",
      "list_features_in_view",
      "select_features",
      "describe_surroundings",
      "compare_areas",
      "set_map_view",
    ]) {
      expect(byName[name].annotations?.untrustedContentHint, name).toBe(true);
    }
  });

  it("registers no new tool: this is a wider contract, not a bigger surface", async () => {
    /*
     * The tools that existed before tier-2 answer about POIs too, by taking a
     * wider `categories` enum. What must never appear is a tool about *loading*:
     * a load_category, a per-category tool, anything an agent has to call before
     * it is allowed to ask its question. That would make the fetch the agent's
     * bookkeeping instead of the map's.
     *
     * The claim is that shape, not a number — T-97 later added
     * get_place_details, which is a different question about one place rather
     * than a step on the way to asking one.
     */
    const names = Object.keys(tier2Ready().byName);
    for (const category of TIER2_CATEGORIES) {
      expect(names.some((n) => n.includes(category)), category).toBe(false);
    }
    expect(names.filter((n) => /load|fetch|categor/.test(n))).toEqual([]);
  });

  it("names the POI category in the activity feed a human reads", async () => {
    const { byName, store } = tier2Ready();
    await call(byName.find_features, { categories: ["fast_food"] }).catch(() => undefined);
    await call(byName.find_features, { categories: ["cafe"], near: "Daan Station" });
    const rows = store.getActivity().map((r) => r.summary);
    expect(rows.at(-1)).toMatch(/^Cafe near/);
  });
});
