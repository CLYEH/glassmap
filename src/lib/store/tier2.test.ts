/**
 * The tier-2 loader, tested where the promises are: idempotency, races,
 * ordering and failure.
 *
 * These are the properties the tool layer is allowed to assume. If a category
 * could load twice, two identical questions would return different feature
 * counts; if a failure were swallowed, "no bakeries near you" would be a lie
 * about a file that never arrived; if the loaded list reflected call order, the
 * same session would describe itself differently depending on what the human
 * asked for first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryToolStore, useMapStore, zustandToolStore } from "./map-store";
import {
  createTier2Registry,
  httpFetchJson,
  parseManifest,
  resolveTier2File,
  TIER2_CATEGORIES,
  TIER2_INDEX_URL,
  type FetchJson,
  type MapFeature,
  type Tier2Backing,
  type Tier2Category,
  type Tier2Manifest,
} from "./tier2";
import {
  createTier2Fetch,
  TIER2_CAFE_COLLECTION,
  TIER2_FILES,
  TIER2_INDEX,
} from "@/lib/map-tools/test-fixtures";

const idsOf = (features: readonly { properties: { id: string } }[]) =>
  features.map((f) => f.properties.id);

/** A backing that keeps its state in local variables; the registry does the rest. */
function backingFor(fetchJson: FetchJson) {
  let manifest: Tier2Manifest | null = null;
  let loaded: Tier2Category[] = [];
  let features: MapFeature[] = [];
  const backing: Tier2Backing = {
    fetchJson,
    getManifest: () => manifest,
    setManifest: (m) => {
      manifest = m;
    },
    getLoadedCategories: () => loaded,
    addLoadedCategory: (category, incoming) => {
      loaded = [...loaded, category].sort();
      features = [...features, ...incoming];
    },
  };
  return {
    registry: createTier2Registry(backing),
    loaded: () => loaded,
    features: () => features,
  };
}

describe("tier-2 loader", () => {
  it("fetches a category once, however many times it is asked for", async () => {
    // Every tool call that names a category calls loadCategory. Re-fetching
    // would put a megabyte on the wire per question and could duplicate ids.
    const { fetchJson, requests } = createTier2Fetch();
    const { registry, features } = backingFor(fetchJson);

    expect(await registry.loadCategory("cafe")).toEqual({
      ok: true,
      category: "cafe",
      fetched: true,
    });
    expect(await registry.loadCategory("cafe")).toEqual({
      ok: true,
      category: "cafe",
      fetched: false,
    });

    expect(requests.filter((u) => u.endsWith("cafe.geojson"))).toHaveLength(1);
    expect(features()).toHaveLength(TIER2_CAFE_COLLECTION.features.length);
  });

  it("shares one fetch between callers that race for the same category", async () => {
    // Two tools can be in flight at once (an agent may call find_features and
    // select_features back to back without awaiting), and both must see the
    // same store rather than two copies of one file.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchJson, requests } = createTier2Fetch();
    const slow: FetchJson = async (url) => {
      if (url.endsWith("cafe.geojson")) await gate;
      return fetchJson(url);
    };
    const { registry, features } = backingFor(slow);

    const both = Promise.all([registry.loadCategory("cafe"), registry.loadCategory("cafe")]);
    release();
    const [first, second] = await both;

    expect(first).toEqual(second);
    expect(requests.filter((u) => u.endsWith("cafe.geojson"))).toHaveLength(1);
    expect(features()).toHaveLength(TIER2_CAFE_COLLECTION.features.length);
  });

  it("reads the index once, not once per category", async () => {
    const { fetchJson, requests } = createTier2Fetch();
    const { registry } = backingFor(fetchJson);
    await registry.loadCategory("cafe");
    await registry.loadCategory("restaurant");
    expect(requests.filter((u) => u === TIER2_INDEX_URL)).toHaveLength(1);
  });

  it("keeps the loaded list sorted, so it never reveals what was asked for first", async () => {
    // get_map_state prints this list. If it were in call order, two sessions
    // that loaded the same categories would describe themselves differently.
    const forward = backingFor(createTier2Fetch().fetchJson);
    await forward.registry.loadCategory("restaurant");
    await forward.registry.loadCategory("cafe");

    const backward = backingFor(createTier2Fetch().fetchJson);
    await backward.registry.loadCategory("cafe");
    await backward.registry.loadCategory("restaurant");

    expect(forward.loaded()).toEqual(["cafe", "restaurant"]);
    expect(forward.loaded()).toEqual(backward.loaded());
    // And nothing is evicted: the first category is still there after the second.
    expect(idsOf(forward.features()).sort()).toEqual(idsOf(backward.features()).sort());
  });

  it("names the category when its file is missing, and loads nothing", async () => {
    // The manifest promises 7 bakeries; the file is not there. Returning an
    // empty result would tell the agent there are no bakeries in Taipei.
    const { registry, loaded, features } = backingFor(createTier2Fetch().fetchJson);
    const result = await registry.loadCategory("bakery");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/bakery/);
    expect(result.error).toMatch(/404/);
    expect(loaded()).toEqual([]);
    expect(features()).toEqual([]);
  });

  it("names the category when the index itself is missing", async () => {
    const { registry } = backingFor(createTier2Fetch(TIER2_FILES, null).fetchJson);
    const result = await registry.loadCategory("cafe");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cafe/);
    expect(result.error).toMatch(TIER2_INDEX_URL);
  });

  it("retries after a failed index instead of poisoning the page", async () => {
    // One dropped request must not turn every later POI question into "no data"
    // for as long as the tab is open.
    let attempts = 0;
    const fetchJson: FetchJson = async (url) => {
      if (url === TIER2_INDEX_URL && attempts++ === 0) throw new Error(`${url}: 503 unavailable`);
      return createTier2Fetch().fetchJson(url);
    };
    const { registry, loaded } = backingFor(fetchJson);

    expect((await registry.loadCategory("cafe")).ok).toBe(false);
    expect((await registry.loadCategory("cafe")).ok).toBe(true);
    expect(loaded()).toEqual(["cafe"]);
  });

  it("refuses a file whose features carry a different category", async () => {
    // "cafe is loaded" plus a cafe query that answers nothing is the worst
    // possible outcome: silent, and indistinguishable from an empty city.
    const wrong = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "osm:node:900", name: "Mislabelled", category: "bar" },
          geometry: { type: "Point", coordinates: [121.5, 25.03] },
        },
      ],
    };
    const files = { ...TIER2_FILES, "/data/tier2/cafe.geojson": wrong };
    const { registry, loaded } = backingFor(createTier2Fetch(files).fetchJson);

    const result = await registry.loadCategory("cafe");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/expected "cafe"/);
    expect(loaded()).toEqual([]);
  });

  it("normalises the generator's format into the shape every tool reads", async () => {
    // The POI files say `name_en` and carry no `source`; the bundled datasets
    // say `nameEn`. One shape reaches the tools, or every tool needs two paths.
    const { registry, features } = backingFor(createTier2Fetch().fetchJson);
    await registry.loadCategory("cafe");
    expect(features()[0].properties).toEqual({
      id: "osm:node:100",
      name: "路易莎咖啡",
      nameEn: "Louisa Coffee",
      category: "cafe",
      source: "osm",
      brand: "Louisa Coffee",
      opening_hours: "Mo-Su 07:00-22:00",
    });
  });
});

describe("tier-2 manifest parsing", () => {
  it("keeps a category the code does not know about out of the way", async () => {
    // A data release can add a 19th category before the schemas do. No tool can
    // name it, so it must be ignored — not made into an error that costs the
    // page all 18 of the categories it does understand.
    const parsed = parseManifest(
      { categories: [...TIER2_INDEX.categories, { category: "casino", count: 3, file: "x.geojson" }] },
      TIER2_INDEX_URL,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.categories.map((c) => c.category)).toEqual(
      TIER2_INDEX.categories.map((c) => c.category),
    );
  });

  it("rejects an entry that cannot be acted on", async () => {
    const parsed = parseManifest({ categories: [{ category: "cafe" }] }, TIER2_INDEX_URL);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/cafe/);
  });

  it("rejects a document that is not a manifest at all", () => {
    expect(parseManifest({ hello: "world" }, TIER2_INDEX_URL).ok).toBe(false);
    expect(parseManifest(null, TIER2_INDEX_URL).ok).toBe(false);
  });

  it("accepts both a bare filename and an absolute path", () => {
    // The data task owns index.json; agreeing on this one detail by guessing
    // would be a broken page in the middle of a demo.
    expect(resolveTier2File("cafe.geojson")).toBe("/data/tier2/cafe.geojson");
    expect(resolveTier2File("/data/tier2/cafe.geojson")).toBe("/data/tier2/cafe.geojson");
  });

  it("lists exactly the 18 agreed categories", () => {
    // The enum in every tool schema is built from this list; adding to it is a
    // contract change, not a tweak.
    expect(TIER2_CATEGORIES).toHaveLength(18);
    expect([...TIER2_CATEGORIES].sort()).toEqual([...new Set(TIER2_CATEGORIES)].sort());
  });
});

describe("the store the app ships", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    useMapStore.setState({
      features: [],
      tier2Features: [],
      tier2Loaded: [],
      tier2Manifest: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /** Serves the fixture over `fetch`, so httpFetchJson is exercised too. */
  function serveFixture() {
    const { fetchJson } = createTier2Fetch();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      try {
        return new Response(JSON.stringify(await fetchJson(url)), { status: 200 });
      } catch {
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
    }) as typeof fetch;
  }

  it("loads a category through fetch and shows it to the tool layer", async () => {
    serveFixture();
    expect(zustandToolStore.getFeatures()).toHaveLength(0);

    expect(await zustandToolStore.loadCategory("cafe")).toMatchObject({ ok: true });

    expect(zustandToolStore.getLoadedCategories()).toEqual(["cafe"]);
    expect(zustandToolStore.getFeatures()).toHaveLength(3);
    expect(zustandToolStore.getTier2Manifest()?.categories).toHaveLength(4);
    // The UI slice is untouched: rendering POIs is a separate decision.
    expect(useMapStore.getState().features).toEqual([]);
    expect(useMapStore.getState().tier2Features).toHaveLength(3);
  });

  it("turns an HTTP failure into a sentence the agent can repeat", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500, statusText: "Server Error" })) as typeof fetch;
    const result = await zustandToolStore.loadCategory("cafe");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cafe/);
    expect(result.error).toMatch(/500 Server Error/);
  });

  it("behaves the same as the in-memory adapter the tool tests assert against", async () => {
    // Every tier-2 tool test runs against createMemoryToolStore. If the two
    // diverged, those tests would be describing an app that does not exist.
    serveFixture();
    const memory = createMemoryToolStore({ tier2FetchJson: createTier2Fetch().fetchJson });

    for (const store of [zustandToolStore, memory]) {
      await store.loadCategory("restaurant");
      await store.loadCategory("cafe");
      await store.loadCategory("cafe");
      expect((await store.loadCategory("bakery")).ok, "bakery has no file").toBe(false);
    }

    expect(zustandToolStore.getLoadedCategories()).toEqual(memory.getLoadedCategories());
    expect(idsOf(zustandToolStore.getFeatures())).toEqual(idsOf(memory.getFeatures()));
    expect(zustandToolStore.getTier2Manifest()).toEqual(memory.getTier2Manifest());
  });

  it("never fetches a category nobody asked for", async () => {
    // The whole design: a page that does not mention POIs makes no POI request.
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(zustandToolStore.getFeatures()).toEqual([]);
    expect(zustandToolStore.getLoadedCategories()).toEqual([]);
    expect(zustandToolStore.getTier2Manifest()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads a manifest over http exactly once", async () => {
    serveFixture();
    const spy = vi.spyOn(globalThis, "fetch");
    await Promise.all([
      zustandToolStore.loadTier2Manifest(),
      zustandToolStore.loadTier2Manifest(),
    ]);
    await zustandToolStore.loadTier2Manifest();
    expect(spy.mock.calls.filter((c) => String(c[0]) === TIER2_INDEX_URL)).toHaveLength(1);
  });
});

describe("httpFetchJson", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("puts the URL and the status in the message, because that is what a tool prints", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 404, statusText: "Not Found" })) as typeof fetch;
    await expect(httpFetchJson("/data/tier2/cafe.geojson")).rejects.toThrow(
      "/data/tier2/cafe.geojson: 404 Not Found",
    );
  });
});
