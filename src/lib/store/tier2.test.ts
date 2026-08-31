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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryToolStore, useMapStore, zustandToolStore } from "./map-store";
import {
  createTier2Registry,
  httpFetchJson,
  HttpStatusError,
  isPermanentFetchError,
  parseCategoryFeatures,
  parseManifest,
  resolveTier2File,
  shareCategories,
  TIER2_CATEGORIES,
  TIER2_FETCH_TIMEOUT_MS,
  TIER2_INDEX_URL,
  type FetchJson,
  type MapFeature,
  type Tier2Backing,
  type Tier2Category,
  type Tier2Manifest,
  type Tier2RestoreFailure,
} from "./tier2";
import {
  createFlakyTier2Fetch,
  createGatedTier2Fetch,
  createTier2Fetch,
  TIER2_CAFE_COLLECTION,
  TIER2_ENRICHED_FILES,
  TIER2_ENRICHED_INDEX,
  TIER2_FILES,
  TIER2_FILES_WITH_BAKERY,
  TIER2_FILES_WITH_DRIFTED_BAKERY,
  TIER2_INDEX,
} from "@/lib/map-tools/test-fixtures";

const idsOf = (features: readonly { properties: { id: string } }[]) =>
  features.map((f) => f.properties.id);

/** A backing that keeps its state in local variables; the registry does the rest. */
function backingFor(fetchJson: FetchJson) {
  let manifest: Tier2Manifest | null = null;
  let loaded: Tier2Category[] = [];
  let features: MapFeature[] = [];
  let pending: Tier2Category[] = [];
  let failures: Tier2RestoreFailure[] = [];
  /**
   * Every write the registry makes to pending or failures, in order, each with
   * the whole picture at that instant. A timing rule lives *between* two
   * assignments, so a test that reads the state once the call has settled
   * cannot fail on one; this is what makes the window observable.
   */
  const trace: { pending: Tier2Category[]; failures: Tier2Category[]; loaded: Tier2Category[] }[] =
    [];
  const snapshot = () =>
    trace.push({
      pending: [...pending],
      failures: failures.map((f) => f.category),
      loaded: [...loaded],
    });
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
      // Both shipped backings clear the failure in this same write; a model
      // that did not would let these tests pass over an app that still calls a
      // loaded category unloadable.
      failures = failures.filter((f) => f.category !== category);
      snapshot();
    },
    getPendingCategories: () => pending,
    setPendingCategories: (categories) => {
      pending = categories;
      snapshot();
    },
    getRestoreFailures: () => failures,
    setRestoreFailures: (f) => {
      failures = f;
      snapshot();
    },
  };
  return {
    registry: createTier2Registry(backing),
    loaded: () => loaded,
    features: () => features,
    pending: () => pending,
    failures: () => failures,
    trace: () => trace,
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
    // The fixture index lists a bakery file that this server does not serve.
    // Returning an empty result would tell the agent there are no bakeries in
    // Taipei, when the truth is that its file never arrived.
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

  it("retries after a 5xx or a dropped connection instead of poisoning the page", async () => {
    // One bad moment must not turn every later POI question into "no data" for
    // as long as the tab is open. Both flavours are here because they arrive
    // differently: a mirror returning 503 carries a status, an offline tab
    // rejects with a bare TypeError from fetch itself.
    const transient = [
      new HttpStatusError(503, `${TIER2_INDEX_URL}: 503 Service Unavailable`),
      new TypeError("Failed to fetch"),
    ];
    for (const error of transient) {
      let attempts = 0;
      const fetchJson: FetchJson = async (url) => {
        if (url === TIER2_INDEX_URL && attempts++ === 0) throw error;
        return createTier2Fetch().fetchJson(url);
      };
      const { registry, loaded } = backingFor(fetchJson);

      expect((await registry.loadCategory("cafe")).ok, error.name).toBe(false);
      expect((await registry.loadCategory("cafe")).ok, error.name).toBe(true);
      expect(loaded()).toEqual(["cafe"]);
    }
  });

  it("asks for a missing index once, not once per question", async () => {
    // The other half of the rule above. A 404 is an answer, not a bad moment:
    // this deployment ships no POI files, and that cannot change while the tab
    // is open. Every bare query calls loadManifest to know what it skipped, so
    // without latching a five-question conversation is five 404s.
    const { fetchJson, requests } = createTier2Fetch(TIER2_FILES, null);
    const { registry } = backingFor(fetchJson);

    for (let i = 0; i < 5; i++) expect((await registry.loadManifest()).ok, `call ${i}`).toBe(false);

    expect(requests.filter((u) => u === TIER2_INDEX_URL)).toHaveLength(1);
  });

  it("keeps saying why after it has stopped asking", async () => {
    // Latching must not turn into silence: an agent that names a category still
    // has to be told the index is missing, or "no cafes" reads as "no cafes
    // exist" rather than "this page has no cafe data".
    const { registry } = backingFor(createTier2Fetch(TIER2_FILES, null).fetchJson);
    await registry.loadManifest();

    const result = await registry.loadCategory("cafe");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cafe/);
    expect(result.error).toMatch(TIER2_INDEX_URL);
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
    // The POI files carry no `source` at all, and spell the English name
    // `nameEn` exactly as the bundled datasets do (public/data/README.md,
    // "Tier-2 categories"). One shape reaches the tools, or every tool that
    // prints a name needs two code paths.
    //
    // Every enrichment tag the file carries comes through with it. A tag the
    // generator writes and this parser drops is data on the human's map that no
    // answer can ever mention, and nothing about that loss is visible: the
    // place is still there, still named, simply mute about its own address.
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
      address: "106012臺北市大安區羅斯福路二段83之1號1樓",
      phone: "+886 2 2362 6229",
      website: "https://www.louisacoffee.co/",
      wheelchair: "limited",
    });
  });

  it("carries a category's own tags, and keeps every value a plain string", async () => {
    // Five categories have a tag nobody else has (`stars` here, `fee` and
    // `capacity` next door). They are carried by the same list as the common
    // ones, so a category the generator learns a new tag for needs one entry in
    // TIER2_TEXT_FIELDS and nothing else.
    const { registry, features } = backingFor(
      createTier2Fetch(TIER2_ENRICHED_FILES, TIER2_ENRICHED_INDEX).fetchJson,
    );
    await registry.loadCategory("hotel");
    await registry.loadCategory("parking");
    const byId = Object.fromEntries(features().map((f) => [f.properties.id, f.properties]));

    expect(byId["osm:node:120"]).toMatchObject({ stars: "5", wheelchair: "yes" });
    expect(byId["osm:node:130"]).toMatchObject({ fee: "yes", capacity: "120" });
    // A number-looking value stays the string OSM stores: "120" is a tag, not a
    // count this layer may do arithmetic on.
    expect(typeof byId["osm:node:130"].capacity).toBe("string");
  });

  it("drops a tag that is present but empty, rather than answering with a blank", async () => {
    // Same posture the name and the three original tags have always had: an
    // empty string in a file is a missing value, and an answer carrying
    // `phone: ""` would tell an agent this place has a phone number.
    const blanks = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: "osm:node:900",
            name: "Blank Fields",
            category: "cafe",
            address: "   ",
            phone: "",
            wheelchair: "yes",
          },
          geometry: { type: "Point", coordinates: [121.5, 25.03] },
        },
      ],
    };
    const parsed = parseCategoryFeatures(blanks, "cafe", "/data/tier2/cafe.geojson");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.features[0].properties).toEqual({
      id: "osm:node:900",
      name: "Blank Fields",
      category: "cafe",
      source: "osm",
      wheelchair: "yes",
    });
  });
});

/**
 * Restoring the categories a share link declared.
 *
 * A link promises to reproduce the sender's map. What travels is category
 * *names*, so the recipient's page has to fetch the same files before the ids
 * in the link's selection mean anything — and everything that runs in the
 * meantime (the address-bar mirror, the agent's next tool call) has to be able
 * to tell "not here yet" from "not real". These tests pin the two moments that
 * distinction depends on.
 */
describe("restoring the categories a share link declared", () => {
  it("declares them before the first fetch, and clears each one as it settles", async () => {
    const { fetchJson } = createTier2Fetch();
    const { registry, pending, loaded, features } = backingFor(fetchJson);

    const settled = registry.restoreCategories(["restaurant", "cafe"]);
    // Synchronously, while nothing has arrived: this is the window a
    // recipient's page spends between opening a link and having its features,
    // and it is exactly when the debounced hash mirror rewrites the URL.
    expect(pending()).toEqual(["cafe", "restaurant"]);
    expect(loaded()).toEqual([]);
    expect(features()).toEqual([]);

    const result = await settled;
    expect(result).toEqual({ ok: true, loaded: ["cafe", "restaurant"], failed: [] });
    expect(pending()).toEqual([]);
    expect(loaded()).toEqual(["cafe", "restaurant"]);
  });

  it("loads them in sorted order, so the recipient's store matches the sender's", async () => {
    // Same rule as planCategories: the features land in the same order on both
    // sides, so a query that ties resolves the same way in both browsers -
    // which is what "the link reproduces the map" has to mean.
    const { fetchJson, requests } = createTier2Fetch();
    const { registry } = backingFor(fetchJson);
    await registry.restoreCategories(["restaurant", "cafe"]);
    expect(requests.filter((u) => u !== TIER2_INDEX_URL)).toEqual([
      "/data/tier2/cafe.geojson",
      "/data/tier2/restaurant.geojson",
    ]);
  });

  it("does not re-fetch a category the page already has", async () => {
    // A human who opens a link, loads cafes, then opens a second link naming
    // cafes must not pay for the file twice - and the category is still part of
    // what the link declared.
    const { fetchJson, requests } = createTier2Fetch();
    const { registry, pending } = backingFor(fetchJson);
    await registry.loadCategory("cafe");

    const settled = registry.restoreCategories(["cafe", "restaurant"]);
    // Nothing to wait for on the cafe side: it is not pending, it is here.
    expect(pending()).toEqual(["restaurant"]);
    expect(await settled).toMatchObject({ ok: true, loaded: ["cafe", "restaurant"] });
    expect(requests.filter((u) => u.endsWith("cafe.geojson"))).toHaveLength(1);
  });

  it("nothing to restore is not an event: no pending, no failure, no fetch", async () => {
    const { fetchJson, requests } = createTier2Fetch();
    const { registry, pending, failures } = backingFor(fetchJson);
    expect(await registry.restoreCategories([])).toEqual({ ok: true, loaded: [], failed: [] });
    expect(pending()).toEqual([]);
    expect(failures()).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("reports a category that will not load, and stops calling it pending", async () => {
    // The bakery is in the index with no file behind it. Leaving it pending
    // would keep the link's ids alive forever on a promise nothing can keep;
    // dropping it silently would leave the recipient looking at a smaller map
    // than the one they were sent, with nothing on screen to say so.
    const { registry, pending, failures } = backingFor(createTier2Fetch().fetchJson);
    const result = await registry.restoreCategories(["bakery", "cafe"]);

    expect(result.ok).toBe(false);
    expect(result.loaded).toEqual(["cafe"]);
    expect(result.failed.map((f) => f.category)).toEqual(["bakery"]);
    expect(result.failed[0].error).toMatch(/bakery\.geojson: 404/);
    // The failure is what remains, and the category is no longer "coming".
    expect(failures()).toEqual(result.failed);
    expect(pending()).toEqual([]);
  });

  it("keeps loading the rest after one category fails", async () => {
    // A restore is not a transaction: cafes that did arrive are real, and the
    // agent is told exactly which category is missing rather than being handed
    // a map that gave up at the first 404.
    const { registry, loaded } = backingFor(createTier2Fetch().fetchJson);
    const result = await registry.restoreCategories(["bakery", "cafe", "restaurant"]);
    expect(loaded()).toEqual(["cafe", "restaurant"]);
    expect(result.failed).toHaveLength(1);
  });

  it("ignores a name that is not a category this build can load", async () => {
    // Only a newer build can put one there. It must not become a pending
    // category nobody can ever settle.
    const { registry, pending } = backingFor(createTier2Fetch().fetchJson);
    const result = await registry.restoreCategories([
      "cafe",
      "teleport_pad" as Tier2Category,
    ]);
    expect(result).toEqual({ ok: true, loaded: ["cafe"], failed: [] });
    expect(pending()).toEqual([]);
  });

  it("never lets a category be unaccounted for, not even between two writes", async () => {
    // Timing rule 2, asserted where it can fail. `select_features` prunes the
    // link's ids exactly when nothing is pending, so an instant in which a
    // failing category has left pending before its failure was written is an
    // instant in which those ids are deleted with nothing on the page to say
    // why - and the page never says it afterwards either, because the failure
    // arrives once the ids are already gone. Asserting over the state once the
    // restore has settled cannot see that instant; asserting over every write
    // can. The bakery is in the index with no file behind it, so this restore
    // walks through the instant if it exists.
    const wanted: Tier2Category[] = ["bakery", "cafe"];
    const { registry, trace } = backingFor(createTier2Fetch().fetchJson);
    await registry.restoreCategories(wanted);

    const unaccounted = trace()
      .map((snap) => ({
        ...snap,
        unaccounted: wanted.filter(
          (c) =>
            !snap.pending.includes(c) && !snap.failures.includes(c) && !snap.loaded.includes(c),
        ),
      }))
      .filter((snap) => snap.unaccounted.length > 0);
    expect(unaccounted).toEqual([]);
    // ... and the walk really did pass through a failure, so the invariant
    // above was not satisfied by a restore that never had anything to record.
    expect(trace().some((snap) => snap.failures.includes("bakery"))).toBe(true);
  });

  it("adds to what another restore is still waiting for instead of replacing it", async () => {
    // Two restores overlapping - a second link applied while the first one's
    // files are still on the wire. Replacing pending would take cafe and
    // restaurant out of "still coming" while they are still coming, and the
    // next select_features would prune every id the first link carried: the
    // damage the pending list exists to prevent, caused by the caller.
    const { fetchJson, release } = createGatedTier2Fetch();
    const { registry, pending } = backingFor(fetchJson);

    const first = registry.restoreCategories(["cafe", "restaurant"]);
    const second = registry.restoreCategories(["convenience"]);
    expect(pending()).toEqual(["cafe", "convenience", "restaurant"]);

    release();
    expect(await first).toMatchObject({ ok: true, loaded: ["cafe", "restaurant"] });
    expect(await second).toMatchObject({ ok: true, loaded: ["convenience"] });
    expect(pending()).toEqual([]);
  });

  it("clears the failures of the categories it is retrying, and nobody else's", async () => {
    // state.tier2.failed is the only place a recipient is told why the ids a
    // link carried are gone. A later restore of some other category must not
    // erase that answer, and retrying the same category must leave one entry,
    // not two.
    const { registry, failures } = backingFor(createTier2Fetch().fetchJson);
    await registry.restoreCategories(["bakery"]);
    expect(failures().map((f) => f.category)).toEqual(["bakery"]);

    await registry.restoreCategories(["cafe"]);
    expect(failures().map((f) => f.category)).toEqual(["bakery"]);

    await registry.restoreCategories(["bakery"]);
    expect(failures().map((f) => f.category)).toEqual(["bakery"]);
  });

  it("records whether asking again could help, per category", async () => {
    // Four failures that read alike in `error` and are not the same event: the
    // bakery is listed with no file behind it (404), the cafe is one second of
    // a server having a bad time (503), the pharmacy is not in this build's
    // index at all, and the restaurant file was served - with a 200 - as
    // something that is not GeoJSON. `shareCategories` turns this single
    // boolean into whether the link this page hands on still declares the
    // category, so guessing it here would make one bad second shrink the map
    // for every reader downstream - or make a link promise a file nobody serves.
    //
    // The unreadable file is the asymmetric one, and it is pinned here rather
    // than left to the reader of the loader: the deployment does list and does
    // serve the category, so calling it permanent would quietly delete a
    // category that exists from every link passing through this page. Being
    // wrong the other way only costs one more request.
    const flaky = createFlakyTier2Fetch("cafe");
    const fetchJson: FetchJson = async (url) =>
      url === "/data/tier2/restaurant.geojson"
        ? { error: "under maintenance" } // a 200 with an error page in it
        : flaky.fetchJson(url);
    const { registry, failures } = backingFor(fetchJson);

    const result = await registry.restoreCategories([
      "cafe",
      "bakery",
      "pharmacy",
      "restaurant",
    ]);

    expect(result.failed.map((f) => [f.category, f.permanent])).toEqual([
      ["bakery", true],
      ["cafe", false],
      ["pharmacy", true],
      ["restaurant", false],
    ]);
    expect(failures()).toEqual(result.failed);
    // The restaurant failure is about the payload, not the request: it must not
    // read as a missing file to whoever relays it, and it is the parse branch
    // that is being pinned here rather than a 404 in disguise.
    expect(result.failed.find((f) => f.category === "restaurant")?.error).toBe(
      '/data/tier2/restaurant.geojson: not a FeatureCollection (no "features" array)',
    );
  });

  it("calls every category permanent when the index itself is a 404", async () => {
    // A page whose data never shipped: there is no file for any of these, and
    // no later request can produce one. Treating that as a moment would have
    // every link this page touches keep declaring categories it cannot serve,
    // and each reader would wait for the same 404 the page already knows about.
    const { registry } = backingFor(createTier2Fetch({}, null).fetchJson);
    const result = await registry.restoreCategories(["cafe"]);
    expect(result.failed.map((f) => f.permanent)).toEqual([true]);
  });

  it("keeps a 5xx on the index retryable, because the file may well be there", async () => {
    // The mirror image, and the reason the flag is not simply "did the index
    // load": a bad gateway now says nothing about what this deployment ships.
    const failing: FetchJson = async (url) => {
      throw new HttpStatusError(503, `${url}: 503 Service Unavailable`);
    };
    const { registry } = backingFor(failing);
    const result = await registry.restoreCategories(["cafe"]);
    expect(result.failed.map((f) => f.permanent)).toEqual([false]);
  });

  it("asks for one file at a time, so the recipient's store is built in link order", async () => {
    // The sorted order is only reproducible if the fetches are sequential:
    // started together, the files land in whatever order the network returns
    // them, and two browsers holding the same categories would answer a query
    // whose results tie differently. The gate is what makes "one at a time"
    // observable - after it, the request log looks the same either way.
    const { fetchJson, requests, release } = createGatedTier2Fetch();
    const { registry } = backingFor(fetchJson);
    const settled = registry.restoreCategories(["restaurant", "cafe"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests.filter((u) => u !== TIER2_INDEX_URL)).toEqual(["/data/tier2/cafe.geojson"]);

    release();
    await settled;
    expect(requests.filter((u) => u !== TIER2_INDEX_URL)).toEqual([
      "/data/tier2/cafe.geojson",
      "/data/tier2/restaurant.geojson",
    ]);
  });
});

/**
 * What a link declares.
 *
 * One function behind both `get_share_link` and the address bar, so the link an
 * agent hands out and the link a human copies out of the URL cannot describe
 * two different maps.
 */
describe("the categories a share link declares", () => {
  const failure = (category: Tier2Category, permanent: boolean): Tier2RestoreFailure => ({
    category,
    error: `could not load "${category}"`,
    permanent,
  });

  it("still declares a category whose file failed for a moment", () => {
    // The recipient whose cafe file caught a 503 re-shares the link they were
    // sent - the address bar does it for them, 300 ms in. Dropping cafe here
    // would hand the third reader the sender's cafe ids with no category
    // declaring them: a selection that page will never resolve, from a link
    // that looks perfectly well formed. One bad second on one machine would
    // permanently shrink the map for everyone downstream of it. Keeping the
    // category simply means the next page asks the server again.
    expect(shareCategories(["restaurant"], [], [failure("cafe", false)])).toEqual([
      "cafe",
      "restaurant",
    ]);
  });

  it("stops declaring a category this deployment does not ship", () => {
    // A 404 is not a moment: no reader of this link will ever get that file, so
    // declaring it only makes each of them wait for the same missing request.
    // This page has already pruned the ids that depended on it for that reason.
    expect(shareCategories(["restaurant"], [], [failure("cafe", true)])).toEqual(["restaurant"]);
  });

  it("merges loaded, still-arriving and retryable categories into one sorted list", () => {
    // All three states exist at once in the second after a link is applied, and
    // a category can be in two of them - loaded now, failed a minute ago. The
    // result is deduped and sorted so two pages holding the same map produce
    // the same link, byte for byte.
    expect(
      shareCategories(
        ["restaurant", "cafe"],
        ["convenience", "cafe"],
        [failure("bakery", false), failure("cafe", false), failure("pharmacy", true)],
      ),
    ).toEqual(["bakery", "cafe", "convenience", "restaurant"]);
  });
});

describe("an id that arrives in two category files", () => {
  /** The merged feature, loaded through the adapter the tools actually use. */
  async function mergedPoi(files: Record<string, unknown>, order: Tier2Category[]) {
    const store = createMemoryToolStore({ tier2FetchJson: createTier2Fetch(files).fetchJson });
    for (const category of order) {
      expect((await store.loadCategory(category)).ok, category).toBe(true);
    }
    const found = store.getFeatures().filter((f) => f.properties.id === "osm:node:112");
    expect(found, order.join(" then ")).toHaveLength(1);
    return found[0];
  }

  it("is one feature under both categories, whichever file arrived first", async () => {
    const forward = await mergedPoi(TIER2_FILES_WITH_BAKERY, ["restaurant", "bakery"]);
    const backward = await mergedPoi(TIER2_FILES_WITH_BAKERY, ["bakery", "restaurant"]);

    expect(forward).toEqual(backward);
    expect(forward.properties.categories).toEqual(["bakery", "restaurant"]);
    // `category` is the head of the sorted union, not the file that happened to
    // win the race: it is printed by find_features, select_features and the
    // activity feed, and two identical questions must print the same word.
    expect(forward.properties.category).toBe("bakery");
  });

  it("takes every field from one file, even when the two files disagree", async () => {
    /*
     * `fetch-tier2.mjs --only=<category>` regenerates one category without
     * touching the others (public/data/README.md), so the bakery file and the
     * restaurant file can be exported weeks apart and an OSM edit in between
     * lands in one of them only. Merging field by field would then produce a
     * feature that exists in neither file; taking the lexicographically-first
     * category's row whole keeps the name, the tags and the category an agent
     * reads out describing the same place at the same moment in time.
     */
    const forward = await mergedPoi(TIER2_FILES_WITH_DRIFTED_BAKERY, ["restaurant", "bakery"]);
    const backward = await mergedPoi(TIER2_FILES_WITH_DRIFTED_BAKERY, ["bakery", "restaurant"]);

    expect(forward).toEqual(backward);
    expect(forward.properties).toEqual({
      id: "osm:node:112",
      name: "多那之咖啡烘焙",
      nameEn: "Donutes Coffee Bakery",
      category: "bakery",
      categories: ["bakery", "restaurant"],
      source: "osm",
      cuisine: "bakery;coffee_shop;breakfast",
      opening_hours: "24/7",
    });
    // Geometry follows the same file, so a distance is measured to the place
    // that file describes rather than to a blend of two exports.
    expect(forward.geometry).toEqual({ type: "Point", coordinates: [121.5406, 25.0346] });
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
      tier2Pending: [],
      tier2RestoreFailures: [],
      tier2Manifest: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /** Serves a tier-2 server over `fetch`, so httpFetchJson is exercised too. */
  function serveWith(fetchJson: FetchJson) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      try {
        return new Response(JSON.stringify(await fetchJson(url)), { status: 200 });
      } catch (e) {
        // The status has to survive the round trip: it is what the registry
        // reads back out of httpFetchJson to tell a moment from a fact.
        const status = e instanceof HttpStatusError ? e.status : 404;
        return new Response("no", { status, statusText: status === 404 ? "Not Found" : "Busy" });
      }
    }) as typeof fetch;
  }

  function serveFixture() {
    serveWith(createTier2Fetch().fetchJson);
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

  it("restores a link's categories for the page and for the tools at once", async () => {
    // The page applies the link (useShareHash calls restoreTier2Categories) and
    // the tools read the result through the adapter. One piece of state, or a
    // spinner could disagree with what select_features believes is coming.
    serveFixture();
    const settled = useMapStore.getState().restoreTier2Categories(["cafe"]);
    expect(useMapStore.getState().tier2Pending).toEqual(["cafe"]);
    expect(zustandToolStore.getPendingCategories()).toEqual(["cafe"]);

    expect(await settled).toMatchObject({ ok: true, loaded: ["cafe"] });
    expect(useMapStore.getState().tier2Pending).toEqual([]);
    expect(zustandToolStore.getFeatures()).toHaveLength(3);
    expect(zustandToolStore.getRestoreFailures()).toEqual([]);
  });

  it("leaves a failed category where the page can show it, not only in a promise", async () => {
    // The promise is resolved inside useShareHash and thrown away; if the
    // failure lived only there, a recipient would be looking at a map missing a
    // whole category with nothing anywhere saying so.
    serveFixture();
    const result = await useMapStore.getState().restoreTier2Categories(["bakery"]);
    expect(result.ok).toBe(false);
    expect(useMapStore.getState().tier2RestoreFailures).toEqual(result.failed);
    expect(zustandToolStore.getRestoreFailures()[0].error).toMatch(/bakery/);
  });

  it("loads a category for the page without ever claiming a link failed", async () => {
    // The page has two loaders and the difference is not bookkeeping.
    // `tier2RestoreFailures` is a claim about a *share link*: the page renders
    // it as "couldn't load cafe for this link" (`ShareRestoreNotice`),
    // `get_map_state` reports it under `tier2.failed`, and `shareCategories`
    // keeps declaring a category that failed for a moment in the next link this
    // page writes — so a recipient downloads the file for it. A search pick has
    // no link behind it, so it takes `loadTier2Category`: when the file does not
    // arrive the picker says so itself, and the store records nothing.
    serveFixture(); // the fixture manifest lists no bakery file
    const failed = await useMapStore.getState().loadTier2Category("bakery");
    expect(failed.ok).toBe(false);
    expect(useMapStore.getState().tier2RestoreFailures).toEqual([]);
    expect(useMapStore.getState().tier2Pending).toEqual([]);

    // The contrast in one place, so unifying the two loaders cannot pass: the
    // same failure through the share-restore loader is exactly the state a
    // linkless page must not be left holding.
    await useMapStore.getState().restoreTier2Categories(["bakery"]);
    expect(useMapStore.getState().tier2RestoreFailures.map((f) => f.category)).toEqual(["bakery"]);

    // And a pick that works still discloses itself where every loaded-but-
    // unpainted category is disclosed: the `poi-loaded` strip reads this list.
    expect(await useMapStore.getState().loadTier2Category("cafe")).toMatchObject({ ok: true });
    expect(useMapStore.getState().tier2Loaded).toEqual(["cafe"]);
    expect(zustandToolStore.getFeatures()).toHaveLength(3);
  });

  it("stops calling a category unloadable the moment its features are in memory", async () => {
    // Reproduced on the live page: a link's cafe file failed, the agent then
    // asked for cafes by name and got all of them, and the page went on saying
    // "couldn't load cafe" over a map, a legend and a state object that all
    // said cafe. The notice is rendered from this list, so the list is where
    // the contradiction has to be impossible - not in each surface that reads
    // it. Pinned on both backings because every tool test asserts against the
    // in-memory one: a rule only the shipped store followed would be a rule no
    // test in this repo could see broken.
    serveWith(createFlakyTier2Fetch("cafe", 1).fetchJson);
    const memory = createMemoryToolStore({
      tier2FetchJson: createFlakyTier2Fetch("cafe", 1).fetchJson,
    });

    for (const store of [zustandToolStore, memory]) {
      expect((await store.restoreCategories(["cafe"])).ok, "the 503 restore").toBe(false);
      expect(store.getRestoreFailures().map((f) => f.category)).toEqual(["cafe"]);
      expect(store.getLoadedCategories()).toEqual([]);

      expect(await store.loadCategory("cafe")).toMatchObject({ ok: true, fetched: true });

      expect(store.getLoadedCategories()).toEqual(["cafe"]);
      expect(store.getRestoreFailures()).toEqual([]);
    }
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

describe("isPermanentFetchError", () => {
  it("keeps the three retry-inviting 4xx retryable, and the rest of 4xx final", async () => {
    // This flag outlives the request twice over: it decides whether the page
    // ever asks for the file again, and whether a link it hands on still
    // declares the category. "4xx means stop" is right for a 404 or a 410 -
    // there is no file - and wrong for the three statuses that exist to say
    // "later": a CDN rate-limiting the 2.5 MB restaurant file with a 429 would
    // otherwise delete restaurants from every link this page produces, from
    // one busy second.
    for (const [status, permanent] of [
      [400, true],
      [403, true],
      [404, true],
      [410, true],
      [451, true],
      [408, false],
      [425, false],
      [429, false],
      [500, false],
      [503, false],
    ] as const) {
      const error = new HttpStatusError(status, `/data/tier2/restaurant.geojson: ${status}`);
      expect(isPermanentFetchError(error), String(status)).toBe(permanent);
    }
    // Anything without a status - a dropped connection, a timeout, a body that
    // would not parse - is a moment as well: only a server saying so makes a
    // failure final.
    expect(isPermanentFetchError(new Error("network error"))).toBe(false);
    expect(isPermanentFetchError(undefined)).toBe(false);
  });

  it("retries a rate-limited category instead of dropping it from the map", async () => {
    // The end-to-end consequence of the line above, and the reason it is not a
    // style question: a 429 must leave the category loadable, and must leave
    // the link this page hands on still declaring it.
    let asked = 0;
    const limited: FetchJson = async (url) => {
      if (url === "/data/tier2/cafe.geojson" && asked++ === 0) {
        throw new HttpStatusError(429, `${url}: 429 Too Many Requests`);
      }
      return createTier2Fetch().fetchJson(url);
    };
    const { registry, loaded } = backingFor(limited);

    const first = await registry.restoreCategories(["cafe"]);
    expect(first.failed.map((f) => [f.category, f.permanent])).toEqual([["cafe", false]]);

    const second = await registry.loadCategory("cafe");
    expect(second).toMatchObject({ ok: true, category: "cafe", fetched: true });
    expect(loaded()).toEqual(["cafe"]);
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

  it("says whether the failure is worth asking about again", async () => {
    // The registry latches a 404 and retries a 500. It decides from the thrown
    // error, so the status has to survive the throw - matching on the message
    // text would break the day a mirror words its status line differently.
    for (const [status, permanent] of [
      [404, true],
      [500, false],
    ] as const) {
      globalThis.fetch = (async () =>
        new Response("", { status, statusText: "why" })) as typeof fetch;
      const error = await httpFetchJson(TIER2_INDEX_URL).catch((e: unknown) => e);
      expect(isPermanentFetchError(error), String(status)).toBe(permanent);
    }
  });

  it("gives a stalled request a deadline, so a tool call cannot hang forever", async () => {
    // A fetch with no signal waits as long as the tab is open: the tool call
    // never returns, and an agent has nothing to report or retry - it just
    // looks like it stopped answering. The 30 s wall clock is not run here (no
    // test is worth 30 s); what is checked is that a signal is passed at all
    // and that the abort comes back as a sentence naming the file.
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, got?: RequestInit) => {
      init = got;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;

    await expect(httpFetchJson("/data/tier2/restaurant.geojson")).rejects.toThrow(
      `/data/tier2/restaurant.geojson: no response after ${TIER2_FETCH_TIMEOUT_MS / 1000}s`,
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});

describe("the manifest this repo actually ships", () => {
  /**
   * The one test that reads public/data instead of a fixture. Everything else
   * in the tool layer agrees with a fixture the tool layer wrote; this is where
   * the two halves of the contract are checked against each other, because
   * nothing else fails when they drift apart. A category in the data but not in
   * TIER2_CATEGORIES can never be asked for (no tool schema can name it, and
   * parseManifest drops it silently); a category in TIER2_CATEGORIES but not in
   * the data is a tool that offers something the page cannot deliver.
   */
  const root = process.cwd();
  const raw = JSON.parse(
    readFileSync(path.join(root, "public/data/tier2/index.json"), "utf8"),
  ) as unknown;

  it("offers exactly the categories the tool schemas can name", () => {
    const listed = (raw as { categories: { category: string }[] }).categories.map(
      (c) => c.category,
    );
    expect([...listed].sort()).toEqual([...TIER2_CATEGORIES].sort());
  });

  it("parses, and every entry points at a file that is there", () => {
    const parsed = parseManifest(raw, TIER2_INDEX_URL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Nothing dropped: parseManifest skipping an entry is exactly how a
    // vocabulary mismatch would hide itself.
    expect(parsed.manifest.categories).toHaveLength(TIER2_CATEGORIES.length);
    for (const entry of parsed.manifest.categories) {
      const file = path.join(root, "public", resolveTier2File(entry.file));
      expect(existsSync(file), entry.category).toBe(true);
      // A category listed with 0 features would be indistinguishable from a
      // mirror that silently returned nothing (see public/data/README.md).
      expect(entry.count, entry.category).toBeGreaterThan(0);
    }
  });

  it("ships the property shape the loader reads, `nameEn` and all", () => {
    // The loader takes `nameEn` and no other spelling. If the generator ever
    // wrote `name_en`, every English name would silently disappear from every
    // answer - a page that looks fine and quietly lost half its content.
    const file = path.join(root, "public/data/tier2/hospital.geojson");
    const parsed = parseCategoryFeatures(
      JSON.parse(readFileSync(file, "utf8")),
      "hospital",
      file,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.features.length).toBeGreaterThan(0);
    expect(parsed.features.some((f) => f.properties.nameEn)).toBe(true);
    expect(parsed.features.every((f) => f.properties.source === "osm")).toBe(true);
  });
});
