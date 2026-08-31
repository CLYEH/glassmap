/**
 * find_features learning to say what it *could* have found.
 *
 * The defect: on a fresh page nothing tier-2 is loaded, so a search for a
 * chain by name answers `total: 0` — over a city holding 152 Starbucks, 151 of
 * which the word "starbucks" reaches (`public/data/README.md`). An agent
 * cannot see that the map is empty, so it reads the zero out to a human as if
 * it were an answer. `unloaded_matches` is the fix, and every test here defends
 * one of the four things that make it worth trusting:
 *
 *  1. it names only categories this session has not loaded, so it is always
 *     about the calls that could follow rather than the one that just ran;
 *  2. its counts are what naming the category actually returns — matched by
 *     the same predicate `queryFeatures` uses, over the same five fields
 *     (name, English name, brand, cuisine, address). Until T-102 both sides
 *     were names only; widening one of them alone would have broken exactly
 *     this promise, which is why the predicate widened rather than the count;
 *  3. it never loads anything. The disclosure *is* the feature: the agent
 *     decides what to fetch, and the map never changes because someone typed a
 *     word;
 *  4. it disappears rather than lies. No index, a failed index, no query — the
 *     answer is exactly the answer it was before T-100.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { createMemoryToolStore, type MemoryToolStoreInit } from "@/lib/store/map-store";
import { SEARCH_INDEX_URL } from "@/lib/store/search-index";
import { HttpStatusError, TIER2_INDEX_URL, type FetchJson } from "@/lib/store/tier2";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { UNLOADED_MATCH_LIMIT, type UnloadedMatch } from "./tier2-query";
import {
  createTier2Fetch,
  FIXTURE_FEATURES,
  TIER2_FILES,
  TIER2_FILES_WITH_BAKERY,
  TIER2_FILES_WITH_DRIFTED_BAKERY,
  TIER2_FILES_WITH_SEARCH_INDEX,
  TIER2_FILES_WITH_WIDE_SEARCH_INDEX,
  TIER2_INDEX,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  total?: number;
  unloaded_matches?: UnloadedMatch[];
  unloaded_matches_omitted?: number;
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

/** The Taipei fixture on a deployment that also ships the citywide index. */
function page(files: Record<string, unknown> = TIER2_FILES_WITH_SEARCH_INDEX, over: MemoryToolStoreInit = {}) {
  const { fetchJson, requests } = createTier2Fetch(files, TIER2_INDEX);
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

const categoryFiles = (requests: string[]) =>
  requests.filter((u) => u !== TIER2_INDEX_URL && u !== SEARCH_INDEX_URL);

describe("a name that exists in a category nobody loaded", () => {
  it("comes back as somewhere to look, not as a zero", async () => {
    // The reported defect, in one call — the *first* call of the session. The
    // index load is awaited rather than fired into the background for exactly
    // this: a background load would make the first search of a session weaker
    // than the second, silently, and an agent that cannot see the screen would
    // read the weaker one out to a human as an answer.
    //
    // Nothing tier-2 is in memory, so the search itself finds nothing — and
    // the answer still knows where the coffee shops are, biggest category
    // first, so the agent's next call is obvious without a second question to
    // the human.
    const { byName } = page();
    const out = await call(byName.find_features, { query: "coffee" });

    expect(out.error).toBeUndefined();
    expect(out.total).toBe(0);
    expect(out.unloaded_matches).toEqual([
      { category: "cafe", count: 3 },
      { category: "fast_food", count: 3 },
      { category: "bakery", count: 2 },
      { category: "bar", count: 2 },
      { category: "restaurant", count: 1 },
    ]);
    // Nothing was dropped, so nothing claims to have been.
    expect(out.unloaded_matches_omitted).toBeUndefined();
  });

  it("counts a cuisine, a brand and an address, because the loaded search does", async () => {
    // The rule the count depends on, and the half of T-102 that is about
    // *this* field. The fixture index holds three rows that match "coffee"
    // through some column other than a name: osm:node:112 through `cuisine`
    // (bakery;coffee_shop), osm:node:302 through `brand` ("Coffee Corner"),
    // osm:node:303 through `address` ("No. 5, Coffee Lane").
    //
    // Before T-102 none of them could be counted, and the reasoning was right
    // at the time: `count` is read as "how many features I get if I name this
    // category", and the loaded search matched names only, so counting these
    // would have promised features the follow-up call could not return. The
    // fix was not to keep quiet about them - it was to stop the two sides
    // matching different things (`matchesQuery`, one predicate, both call
    // sites). Now the promise and its fulfilment are the same five fields, and
    // silence here would be the lie: a person searching for a coffee shop by
    // cuisine would be told there is nothing to load.
    const { byName } = page();
    const out = await call(byName.find_features, { query: "coffee" });
    const counts = Object.fromEntries(
      (out.unloaded_matches ?? []).map((m) => [m.category, m.count]),
    );

    // restaurant is here at all only through node:112's cuisine.
    expect(counts.restaurant).toBe(1);
    // fast_food: node:304 by name, node:302 by brand, node:303 by address.
    expect(counts.fast_food).toBe(3);
  });

  it("promises a floor the follow-up call keeps, for a match on any of the five", async () => {
    // The contract in one round trip: whatever the disclosure said about a
    // category, naming it returns *at least* that many features. If these two
    // ever disagree downwards, the field is worse than useless - it sends the
    // agent to fetch a megabyte for matches that are not there.
    //
    // Checked per category rather than on one of them, and with a query that
    // reaches every column the index has: node:112 is disclosed under
    // restaurant purely on `cuisine`, and loading restaurant has to find it, or
    // the widened count would be the exact over-promise the old names-only
    // rule existed to prevent.
    //
    // The promise is about an index generated from the files it indexes, which
    // is what `scripts/build-search-index.mjs` builds and validates. Two of
    // this fixture's categories are deliberately not that: bar and fast_food
    // are index rows with no file behind them (which is what makes them useful
    // above), and the bakery file holds one of the two rows the index files
    // under bakery. They are named rather than filtered by a predicate, so a
    // category that quietly stopped being reconcilable fails this test instead
    // of being skipped by it.
    const disclosed = await call(page().byName.find_features, { query: "coffee" });
    const counts = disclosed.unloaded_matches ?? [];
    const derived = counts.filter((m) => ["cafe", "restaurant"].includes(m.category));
    expect(derived.map((m) => m.category)).toEqual(["cafe", "restaurant"]);

    for (const { category, count } of derived) {
      // A fresh page per category: loading one changes what the next
      // disclosure would say, and this is a claim about a single follow-up.
      const fresh = page().byName;
      const loaded = await call(fresh.find_features, { query: "coffee", categories: [category] });
      expect(loaded.error, category).toBeUndefined();
      expect(loaded.total ?? 0, category).toBeGreaterThanOrEqual(count);
    }
    // restaurant is the one that matters: its only match is node:112, reached
    // through `cuisine` alone. A count that widened without the loaded search
    // widening with it would fail right here.
    expect(derived.find((m) => m.category === "restaurant")?.count).toBe(1);
  });

  it("is a floor and not an equality, because a loaded file can hold more than the index counted", async () => {
    // Why the invariant above is >= rather than ==, in the case that makes it
    // so. A dual-tagged id's row is written from whichever file the generator
    // read first, and the other file can drift away from it afterwards
    // (`fetch-tier2.mjs --only=<category>` regenerates one category, so an OSM
    // rename lands in one of them only). Here the bakery file calls node:112
    // 多那之咖啡烘焙 / "Donutes Coffee Bakery" and the index row - the
    // restaurant file's copy - has never heard that name.
    //
    // So the disclosure says nothing while the category itself holds a match,
    // and that is the safe direction: it under-counts, never over-counts, so an
    // agent acting on it is never sent after features that are not there. The
    // other, permanent source of the same slack is the dual-tagged row below.
    const { byName } = page({
      ...TIER2_FILES_WITH_DRIFTED_BAKERY,
      [SEARCH_INDEX_URL]: TIER2_FILES_WITH_SEARCH_INDEX[SEARCH_INDEX_URL],
    });
    const disclosed = await call(byName.find_features, { query: "咖啡烘焙" });
    // The index (restaurant's copy of the row) has never heard that name.
    expect(disclosed.unloaded_matches).toBeUndefined();

    const loaded = await call(byName.find_features, { query: "咖啡烘焙", categories: ["bakery"] });
    expect(loaded.total).toBe(1);
  });
});

describe("what the disclosure refuses to do", () => {
  it("never loads a category to answer a search", async () => {
    // The line the whole feature stands on. Fetching 2.5 MB because someone
    // typed a word would make what is on the map a function of what was
    // searched for, and an agent that cannot see the screen would have no way
    // to know the map had changed under it.
    const { byName, requests, store } = page();
    await call(byName.find_features, { query: "coffee" });

    expect(categoryFiles(requests)).toEqual([]);
    expect(store.getLoadedCategories()).toEqual([]);
    expect(store.getFeatures()).toHaveLength(FIXTURE_FEATURES.length);
  });

  it("fetches nothing at all for a search that named no name", async () => {
    // A search with no query matched every name; it has nothing to say about
    // names elsewhere, and must not pay 3.5 MB to say it.
    const { byName, requests } = page();
    await call(byName.find_features, {});
    await call(byName.find_features, { categories: ["cafe"] });

    expect(requests).not.toContain(SEARCH_INDEX_URL);
  });

  it("offers a category only once, and only while it is still missing", async () => {
    // Disclosure tracks memory. Once the agent has taken the hint and loaded
    // cafes, repeating the same search must not go on offering them - the
    // features are in the answer above, and offering them again is how an agent
    // ends up fetching the same file twice and reporting the same shops twice.
    const { byName } = page();
    await call(byName.find_features, { categories: ["cafe"] });

    const out = await call(byName.find_features, { query: "coffee" });

    expect(out.total).toBe(3);
    expect(out.unloaded_matches?.map((m) => m.category)).toEqual([
      "fast_food",
      "bakery",
      "bar",
      "restaurant",
    ]);
  });

  it("drops a dual-tagged row entirely once either of its categories is loaded", async () => {
    // osm:node:304 is filed under bakery and fast_food. With bakery loaded it
    // is already in memory and already searchable, so it is not something the
    // page is missing - and counting it under fast_food would offer the agent a
    // file to fetch for a feature it can already see. That makes `count` a
    // floor rather than an exact figure for the 12 dual-tagged ids city-wide,
    // which is the safe direction: naming fast_food returns this row too.
    const { byName } = page({
      ...TIER2_FILES_WITH_BAKERY,
      [SEARCH_INDEX_URL]: TIER2_FILES_WITH_SEARCH_INDEX[SEARCH_INDEX_URL],
    });
    await call(byName.find_features, { categories: ["bakery"] });

    const out = await call(byName.find_features, { query: "coffee" });

    // node:112 (bakery,restaurant) goes with it, so restaurant - which the
    // widened predicate reaches only through that row's cuisine - is gone too.
    expect(out.unloaded_matches).toEqual([
      { category: "cafe", count: 3 },
      { category: "bar", count: 2 },
      { category: "fast_food", count: 2 },
    ]);
    // And this is the floor, at its widest: restaurant is not disclosed at all,
    // because its only matching row is node:112 and bakery already holds it -
    // yet naming restaurant still returns that row. Under-counted (0 against
    // 1), never over-counted, which is the direction an agent can act on.
    const loaded = await call(byName.find_features, {
      query: "coffee",
      categories: ["restaurant"],
    });
    expect(loaded.total).toBe(1);
  });

  it("cannot name a category the caller just asked for", async () => {
    // The index is consulted after the call's own categories have loaded, so
    // "here is what you are missing" can never include the thing the agent
    // explicitly asked for and received.
    const { byName } = page();
    const out = await call(byName.find_features, { query: "coffee", categories: ["cafe"] });

    expect(out.total).toBe(3);
    expect(out.unloaded_matches?.map((m) => m.category)).not.toContain("cafe");
    expect(out.unloaded_matches).toEqual([
      { category: "fast_food", count: 3 },
      { category: "bakery", count: 2 },
      { category: "bar", count: 2 },
      { category: "restaurant", count: 1 },
    ]);
  });

  it("belongs to find_features alone", async () => {
    // select_features takes the same filter and shares the same resolver, so
    // the field could have leaked into it for free. It must not: its answer is
    // about what is highlighted on a map now, and a list of files it did not
    // fetch is a hint about searching, not about selecting.
    const { byName } = page();
    const selected = await call(byName.select_features, { query: "coffee" });
    const inView = await call(byName.list_features_in_view, { query: "coffee" });

    expect(selected.unloaded_matches).toBeUndefined();
    expect(inView.unloaded_matches).toBeUndefined();
  });
});

describe("when the index is not there", () => {
  it("answers exactly as it did before T-100 on a deployment that ships none", async () => {
    // Every field of the pre-T-100 answer, and nothing after it. A build
    // without the file is not a degraded build; it is the app as it shipped.
    const { byName } = page(TIER2_FILES);
    const out = await call(byName.find_features, { query: "coffee" });

    expect(out.error).toBeUndefined();
    expect(Object.keys(out)).toEqual([
      "total",
      "returned",
      "features",
      "origin",
      "searched_categories",
      "unsearched_categories",
    ]);
  });

  it("costs the hint and never the answer when the file fails", async () => {
    // A 503 on a 3.5 MB file is an ordinary bad second. The search still has to
    // answer about what is loaded: silently failing the whole call would turn a
    // question the page could answer into an error, over a hint.
    const server = createTier2Fetch(TIER2_FILES_WITH_SEARCH_INDEX, TIER2_INDEX);
    const flaky: FetchJson = async (url) => {
      if (url === SEARCH_INDEX_URL) throw new HttpStatusError(503, `${url}: 503 Busy`);
      return server.fetchJson(url);
    };
    const { byName } = page(TIER2_FILES_WITH_SEARCH_INDEX, { tier2FetchJson: flaky });

    const out = await call(byName.find_features, { query: "大安" });

    expect(out.error).toBeUndefined();
    // 大安 names the station, the park and the district in the bundled data.
    expect(out.total).toBeGreaterThan(0);
    expect(out.unloaded_matches).toBeUndefined();
  });

  it("says nothing rather than nothing-shaped when no category matches", async () => {
    // An empty list would read as "there is nowhere else to look", which is a
    // claim; an absent field is the absence of one. The word here matches
    // nothing anywhere, and the index was still consulted.
    const { byName, requests } = page();
    const out = await call(byName.find_features, { query: "zzzznowhere" });

    expect(requests).toContain(SEARCH_INDEX_URL);
    expect(out.unloaded_matches).toBeUndefined();
    expect(out.unloaded_matches_omitted).toBeUndefined();
  });
});

describe("keeping the answer small", () => {
  it(`lists the ${UNLOADED_MATCH_LIMIT} biggest categories and counts the rest`, async () => {
    // A common word can hit every category there is. The field is a pointer to
    // the next call, not a report, so it keeps the categories most likely to be
    // what the human meant - and says how many it left out, because a capped
    // list that looks complete is how an agent concludes there is nowhere else
    // to look.
    const { byName } = page(TIER2_FILES_WITH_WIDE_SEARCH_INDEX);
    const out = await call(byName.find_features, { query: "wide" });

    expect(out.unloaded_matches).toEqual([
      { category: "restaurant", count: 8 },
      { category: "cafe", count: 7 },
      { category: "bar", count: 6 },
      { category: "bakery", count: 5 },
      { category: "fast_food", count: 4 },
      { category: "convenience", count: 3 },
    ]);
    expect(out.unloaded_matches).toHaveLength(UNLOADED_MATCH_LIMIT);
    // pharmacy (2) and clinic (1) were dropped, and the answer says so.
    expect(out.unloaded_matches_omitted).toBe(2);
  });

  it("leaves the agent-activity row exactly as it was", async () => {
    // The feed is what the human watching the screen reads. A disclosure is a
    // hint to the agent about calls it has not made yet, not something that
    // happened on this map - so it stays out of the row, and the summariser
    // needs no knowledge of it.
    const { byName, store } = page();
    await call(byName.find_features, { query: "coffee" });

    const [row] = store.getActivity();
    expect(row.tool).toBe("find_features");
    expect(row.summary).toBe("“coffee” — found 0");
    expect(row.ok).toBe(true);
  });
});
