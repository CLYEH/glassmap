/**
 * The citywide search index, tested where it can lie.
 *
 * Everything downstream of this file is a *promise*: find_features' answer
 * says "there are 151 of those in a category you have not loaded", and an
 * agent that cannot see the screen relays it to a human. So the properties
 * that matter here are the ones that would turn that sentence into a lie:
 *
 *  - a row counted twice, or a row kept that the contract says is unusable —
 *    the count stops being the number naming the category returns;
 *  - a file fetched twice — 3.5 MB on the wire per search, for a field that is
 *    a hint;
 *  - a failure remembered as an answer — a page that caught one bad second
 *    would spend the rest of the session unable to say what it could find,
 *    with nothing on screen contradicting it;
 *  - a 404 forgotten — a deployment that ships no index would be asked for it
 *    once per question, for the life of the tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryToolStore, useMapStore, zustandToolStore } from "./map-store";
import {
  createSearchIndexLoader,
  parseSearchIndex,
  SEARCH_INDEX_URL,
  type SearchIndexBacking,
  type SearchIndexEntry,
  type SearchIndexStatus,
} from "./search-index";
import { HttpStatusError, type FetchJson } from "./tier2";
import { TIER2_SEARCH_INDEX } from "@/lib/map-tools/test-fixtures";

/** One well-formed row of the tuple contract; `at` swaps a single column. */
const ROW: unknown[] = [
  "osm:node:1",
  "路易莎咖啡",
  "Louisa Coffee",
  "Louisa Coffee",
  "coffee_shop",
  "羅斯福路二段83號",
  "cafe",
  121.5432,
  25.0338,
];

const at = (index: number, value: unknown) => ROW.map((v, i) => (i === index ? value : v));

const doc = (...rows: unknown[]) => ({ generated: "2026-08-31", rows });

describe("reading one row of the index", () => {
  it("names every column of the tuple contract", () => {
    // Positions are the contract (public/data/README.md, "Shape"): the file is
    // tuples rather than objects to survive 31k rows, so the only thing that
    // says which column is which is this function. A column read one place to
    // the left is data the page holds and can never say correctly.
    expect(parseSearchIndex(doc(ROW))).toEqual([
      {
        id: "osm:node:1",
        name: "路易莎咖啡",
        nameEn: "Louisa Coffee",
        brand: "Louisa Coffee",
        cuisine: "coffee_shop",
        address: "羅斯福路二段83號",
        categories: ["cafe"],
        lng: 121.5432,
        lat: 25.0338,
      },
    ]);
  });

  it("leaves a column the source did not have absent, never empty", () => {
    // The wire writes "" for a tag OSM does not have. Carrying that through as
    // an empty string would make every row match every query on that field:
    // "".includes(x) is false, but a caller checking `entry.address !== ""`
    // reads presence, and a place with no address would claim one.
    const bare = parseSearchIndex(
      doc(["osm:node:1", "路易莎咖啡", "", "", "", "", "cafe", 121.5432, 25.0338]),
    );
    expect(bare).toEqual([
      {
        id: "osm:node:1",
        name: "路易莎咖啡",
        categories: ["cafe"],
        lng: 121.5432,
        lat: 25.0338,
      },
    ]);
  });

  it("keeps both categories of a dual-tagged id, sorted and deduped", () => {
    // 12 ids city-wide are filed in two category files. Naming either category
    // has to return the feature, so the disclosure has to count it under both
    // — and sorting here is what stops the same file producing two different
    // orders on two runs.
    expect(parseSearchIndex(doc(at(6, "fast_food,bakery,bakery")))?.[0].categories).toEqual([
      "bakery",
      "fast_food",
    ]);
  });

  it("drops a row it cannot act on and keeps every other one", () => {
    // The posture parseCategoryFeatures takes, for the same reason: one bad row
    // must not cost the other 31,056 their citywide search. Nothing here is
    // ever drawn or selected — only counted — so a dropped row makes the
    // disclosure smaller and never wrong.
    const unusable: [string, unknown][] = [
      ["not an array at all", "osm:node:2,cafe"],
      ["a row missing its trailing columns", ["osm:node:2", "咖啡", "", "", "", "", "cafe"]],
      ["a row with no id", at(0, "")],
      ["a row with no name", at(1, "   ")],
      ["a row whose only category this build cannot name", at(6, "search-index")],
      ["a row with no category at all", at(6, "")],
      ["a row whose longitude is off the planet", at(7, 421.5)],
      ["a row whose latitude is not a number", at(8, "25.0338")],
    ];
    for (const [why, bad] of unusable) {
      const entries = parseSearchIndex(doc(bad, at(0, "osm:node:9")));
      expect(entries?.map((e) => e.id), why).toEqual(["osm:node:9"]);
    }
  });

  it("counts an id once, however many times the file repeats it", () => {
    // The generator guarantees unique ids (public/data/README.md,
    // "Validation"). A duplicate that slipped through would be counted twice by
    // the disclosure — and the count is a promise about how many features
    // naming a category returns, so a doubled row makes it a lie.
    const entries = parseSearchIndex(doc(ROW, at(1, "路易莎咖啡 二號店"), at(0, "osm:node:2")));
    expect(entries?.map((e) => e.id)).toEqual(["osm:node:1", "osm:node:2"]);
    expect(entries?.[0].name).toBe("路易莎咖啡");
  });

  it("tells a document that is not an index from an index with nothing in it", () => {
    // The difference decides whether the page ever asks again: an unreadable
    // document is what a truncated or intercepted response looks like, and is
    // worth retrying. An index that is genuinely empty is an answer.
    for (const notAnIndex of [null, 42, "rows", [], { categories: [] }, { rows: {} }]) {
      expect(parseSearchIndex(notAnIndex), JSON.stringify(notAnIndex)).toBeNull();
    }
    expect(parseSearchIndex(doc())).toEqual([]);
  });
});

/** A backing that keeps its state in local variables; the loader does the rest. */
function loaderFor(fetchJson: FetchJson) {
  let status: SearchIndexStatus = "idle";
  let entries: readonly SearchIndexEntry[] | null = null;
  /** Every write, in order: a status that is only ever visible mid-flight is a
   * state a test that awaits first cannot see. */
  const writes: SearchIndexStatus[] = [];
  const backing: SearchIndexBacking = {
    fetchJson,
    getStatus: () => status,
    set: (next, rows) => {
      status = next;
      entries = rows;
      writes.push(next);
    },
  };
  return {
    loader: createSearchIndexLoader(backing),
    status: () => status,
    entries: () => entries,
    writes: () => writes,
  };
}

/** A host that serves one document, counting what was asked of it. */
function serve(document: unknown = TIER2_SEARCH_INDEX) {
  const requests: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    requests.push(url);
    return document;
  };
  return { fetchJson, requests };
}

/** A host that fails `times` requests with `status`, then serves the index. */
function failing(status: number, times = Number.POSITIVE_INFINITY) {
  const requests: string[] = [];
  let failed = 0;
  const fetchJson: FetchJson = async (url) => {
    requests.push(url);
    if (failed < times) {
      failed += 1;
      throw new HttpStatusError(status, `${url}: ${status}`);
    }
    return TIER2_SEARCH_INDEX;
  };
  return { fetchJson, requests };
}

describe("loading the index", () => {
  it("asks for it by its literal path, once, however many searches want it", async () => {
    // It is not in the tier-2 manifest and cannot be: that manifest's category
    // list is pinned to the 18 categories a tool schema can name. And at 3.5 MB
    // a second fetch is not a rounding error — it is the whole file again, per
    // search.
    const { fetchJson, requests } = serve();
    const { loader, status, entries } = loaderFor(fetchJson);

    await loader.load();
    await loader.load();
    await loader.load();

    expect(requests).toEqual([SEARCH_INDEX_URL]);
    expect(status()).toBe("ready");
    expect(entries()).toHaveLength(TIER2_SEARCH_INDEX.rows.length);
  });

  it("shares one request between searches that race for it", async () => {
    // Two tool calls can be in flight at once — an agent may not await the
    // first — and both must end up looking at one index rather than two copies.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchJson, requests } = serve();
    const gated: FetchJson = async (url) => {
      await gate;
      return fetchJson(url);
    };
    const { loader, entries } = loaderFor(gated);

    const both = Promise.all([loader.load(), loader.load()]);
    release();
    await both;

    expect(requests).toEqual([SEARCH_INDEX_URL]);
    expect(entries()).toHaveLength(TIER2_SEARCH_INDEX.rows.length);
  });

  it("says loading before it says ready, so nothing calls a pending index missing", async () => {
    // getSearchIndex() is null in both states. The status is the only thing
    // that can tell a surface "wait" from "there is none", and it has to be
    // true from before the first await — otherwise the whole window in which
    // the distinction matters is a window in which it says "idle".
    const { fetchJson } = serve();
    const { loader, status, writes } = loaderFor(fetchJson);

    const settled = loader.load();
    expect(status()).toBe("loading");
    await settled;

    expect(writes()).toEqual(["loading", "ready"]);
  });

  it("remembers a 404 as a fact about the deployment and never asks again", async () => {
    // A build that ships no index will not grow one while the tab is open. The
    // same latch the tier-2 manifest keeps for the same reason: without it,
    // every query-bearing tool call spends a request re-learning it.
    const { fetchJson, requests } = failing(404);
    const { loader, status, entries } = loaderFor(fetchJson);

    await loader.load();
    await loader.load();
    await loader.load();

    expect(status()).toBe("absent");
    expect(entries()).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("retries after a bad second, because one 503 must not cost a session its search", async () => {
    // A 5xx or a dropped connection is a moment, not a fact. Latching it would
    // leave the page unable to say what it could find for the rest of the
    // session — silently, since a missing disclosure looks exactly like a query
    // that matched nothing anywhere.
    const { fetchJson, requests } = failing(503, 1);
    const { loader, status, entries } = loaderFor(fetchJson);

    await loader.load();
    expect(status(), "after the 503").toBe("failed");
    expect(entries()).toBeNull();

    await loader.load();

    expect(status()).toBe("ready");
    expect(entries()).toHaveLength(TIER2_SEARCH_INDEX.rows.length);
    expect(requests).toHaveLength(2);
  });

  it("treats a document it cannot read as a moment too", async () => {
    // The file was served, so the deployment does have it; what arrived was not
    // an index. That is what a truncated response or a captive-portal login
    // page looks like, and the next search deserves a second try.
    let body: unknown = { nope: true };
    const requests: string[] = [];
    const { loader, status, entries } = loaderFor(async (url) => {
      requests.push(url);
      return body;
    });

    await loader.load();
    expect(status()).toBe("failed");

    body = TIER2_SEARCH_INDEX;
    await loader.load();

    expect(status()).toBe("ready");
    expect(entries()).not.toBeNull();
    expect(requests).toHaveLength(2);
  });
});

describe("the stores the page and the tools share", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    useMapStore.setState({ searchIndex: null, searchIndexStatus: "idle" });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /** Serves the index over `fetch`, so httpFetchJson is exercised too. */
  function serveOverHttp(document: unknown = TIER2_SEARCH_INDEX) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(document), { status: 200 })) as typeof fetch;
  }

  it("never fetches an index nobody searched for", async () => {
    // The lazy half of the contract: a page that only pans and clicks pays
    // nothing for a file that exists to answer questions nobody asked.
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(zustandToolStore.getSearchIndex()).toBeNull();
    expect(useMapStore.getState().searchIndexStatus).toBe("idle");
    expect(spy).not.toHaveBeenCalled();
  });

  it("hands the page and the tool layer one index, read the same way", async () => {
    // The page's search box reads useMapStore; find_features reads the adapter.
    // Two copies would let the human's search and the agent's disclosure
    // disagree about what exists in a city neither of them can see all of.
    serveOverHttp();
    await zustandToolStore.loadSearchIndex();

    expect(zustandToolStore.getSearchIndex()).toBe(useMapStore.getState().searchIndex);
    expect(useMapStore.getState().searchIndexStatus).toBe("ready");
    expect(zustandToolStore.getSearchIndex()).toHaveLength(TIER2_SEARCH_INDEX.rows.length);
  });

  it("reads it over http exactly once, whoever asks", async () => {
    serveOverHttp();
    const spy = vi.spyOn(globalThis, "fetch");
    await Promise.all([
      zustandToolStore.loadSearchIndex(),
      useMapStore.getState().loadSearchIndex(),
    ]);
    await zustandToolStore.loadSearchIndex();
    expect(spy.mock.calls.filter((c) => String(c[0]) === SEARCH_INDEX_URL)).toHaveLength(1);
  });

  it("behaves the same as the in-memory adapter the tool tests assert against", async () => {
    // Every disclosure test in map-tools runs against createMemoryToolStore. If
    // the two diverged, those tests would describe an app that does not exist.
    serveOverHttp();
    const memory = createMemoryToolStore({ tier2FetchJson: serve().fetchJson });

    for (const store of [zustandToolStore, memory]) {
      await store.loadSearchIndex();
      await store.loadSearchIndex();
    }

    expect(zustandToolStore.getSearchIndex()).toEqual(memory.getSearchIndex());
    expect(useMapStore.getState().searchIndexStatus).toBe(memory.getSearchIndexStatus());
  });

  it("degrades to no index on a deployment that ships none, on both stores", async () => {
    // The default state of the whole unit suite, and of any build that does not
    // carry the file: null, "absent", and not a single throw anywhere.
    globalThis.fetch = (async () =>
      new Response("no", { status: 404, statusText: "Not Found" })) as typeof fetch;
    const memory = createMemoryToolStore();

    for (const store of [zustandToolStore, memory]) {
      await expect(store.loadSearchIndex()).resolves.toBeUndefined();
      expect(store.getSearchIndex()).toBeNull();
    }
    expect(useMapStore.getState().searchIndexStatus).toBe("absent");
    expect(memory.getSearchIndexStatus()).toBe("absent");
  });
});
