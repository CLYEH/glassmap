import { describe, expect, it } from "vitest";
import { QUERY_FIELDS } from "@/lib/map-tools/query";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import type { SearchIndexEntry, SearchIndexStatus } from "@/lib/store/search-index";
import { TIER2_CATEGORIES, type MapCategory, type MapFeature } from "@/lib/store/tier2";
import { searchIndexEntries, type IndexHit } from "./search-index-model";
import {
  SEARCH_LIMIT,
  composeSearchRows,
  formatDistance,
  searchEmptyNote,
  searchLoadedFeatures,
  type SearchHit,
} from "./search-model";
import type { CategoryRow } from "./search-vocabulary";

/** Taipei Main Station, the default view centre. */
const ORIGIN: LngLat = [121.5175, 25.0478];
/** A tight box around the origin: ~1.1 km across, so "in view" is a real filter. */
const VIEW: Bounds = [121.512, 25.043, 121.523, 25.053];

const place = (
  id: string,
  properties: Partial<MapFeature["properties"]> & { category?: MapCategory } = {},
  at: LngLat = ORIGIN,
): MapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties: {
    id,
    name: properties.name ?? id,
    category: properties.category ?? "cafe",
    source: "osm",
    ...properties,
  },
});

/** Roughly `km` east of the origin — enough to leave a 1 km-wide view. */
const east = (km: number): LngLat => [ORIGIN[0] + km * 0.0099, ORIGIN[1]];

const search = (
  query: string,
  options: {
    features?: MapFeature[];
    tier2Features?: MapFeature[];
    bounds?: Bounds | null;
    loaded?: (typeof TIER2_CATEGORIES)[number][];
    limit?: number;
  } = {},
) =>
  searchLoadedFeatures({
    features: options.features ?? [],
    tier2Features: options.tier2Features ?? [],
    query,
    bounds: options.bounds === undefined ? VIEW : options.bounds,
    origin: ORIGIN,
    loadedCategories: options.loaded ?? [],
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });

/**
 * The search box is the one thing on this map a person can do that used to
 * need an agent to phrase: "where is X". Everything asserted here is about the
 * two ways that promise breaks — the box not finding what the map is holding,
 * or the box claiming the map holds nothing when it simply never fetched the
 * file.
 */
describe("searchLoadedFeatures", () => {
  it("matches all five fields a person might type, in any case", () => {
    // A person types the word in their head, and four of these five words are
    // not the place's name. Since T-102 they are `QUERY_FIELDS` exactly, so
    // every one of them is also a word a tool call would have matched.
    const features = [
      place("named", { name: "台北車站", nameEn: "Taipei Main Station", category: "mrt_station" }),
      place("branded", { name: "全家", brand: "FamilyMart", category: "convenience" }),
      place("cooked", { name: "無名小吃", cuisine: "vegetarian;taiwanese", category: "restaurant" }),
      place("addressed", { name: "小店", address: "臺北市士林區基河路 130 號", category: "cafe" }),
    ];
    expect(search("台北車", { features }).hits.map((h) => h.id)).toEqual(["named"]);
    expect(search("taipei main", { features }).hits.map((h) => h.id)).toEqual(["named"]);
    expect(search("familymart", { features }).hits.map((h) => h.id)).toEqual(["branded"]);
    expect(search("VEGETARIAN", { features }).hits.map((h) => h.id)).toEqual(["cooked"]);
    expect(search("基河路", { features }).hits.map((h) => h.id)).toEqual(["addressed"]);
  });

  it("finds a loaded place by its address, the way a person says where", () => {
    // The T-102 defect, as a test. This matcher read four fields while the
    // citywide list beside it read five, so typing a street name found a café
    // the map had NOT fetched and stayed silent about the one it was holding —
    // the box contradicting itself, on the same keystroke.
    const cafe = place("osm:node:1", { name: "路易莎", address: "臺北市中正區忠孝西路一段 47 號" });
    expect(search("忠孝西路", { tier2Features: [cafe] }).hits.map((h) => h.id)).toEqual([
      "osm:node:1",
    ]);
    // The other four still answer on the same feature, unchanged.
    expect(search("路易莎", { tier2Features: [cafe] }).total).toBe(1);
  });

  it("finds a place by the word for what it serves, not only by its name", () => {
    // A café whose name says nothing about coffee is still what "coffee" means
    // — and since T-102 `find_features({query: "coffee"})` returns it too.
    const cafe = place("osm:node:1", { name: "路易莎", cuisine: "coffee_shop" });
    expect(search("coffee", { tier2Features: [cafe] }).total).toBe(1);
  });

  it("folds spelling the way the tools do, so one map has one answer", () => {
    // `normaliseName` is shared with the gazetteer on purpose: OSM writes
    // "Da-an Forest Park" and people type "Daan".
    const park = place("park", { name: "Da-an Forest Park", category: "park" });
    expect(search("daan forest", { features: [park] }).total).toBe(1);
  });

  it("is not a search at all until something is typed", () => {
    // What keeps the dropdown shut on a box a person has merely focused: no
    // rows, and nothing counted as "left out".
    const features = [place("a"), place("b")];
    for (const query of ["", "   ", "\t"]) {
      const answer = search(query, { features });
      expect(answer.hits).toEqual([]);
      expect(answer.total).toBe(0);
      expect(answer.overflow).toBe(0);
    }
  });

  it("puts what you can see first, even when the thing off screen is nearer", () => {
    // The ranking rule that makes the box feel like it is about *this* map,
    // and the fixture is chosen so that ONLY that rule can produce the
    // asserted order: `on-screen` sits in the view's north-east corner at
    // ~771 m, `off-screen` is ~614 m away but just past the eastern edge
    // (121.523). Sorted by distance alone the two come back the other way
    // round, so deleting the `inView` sort key turns this red.
    const onScreen = place("on-screen", { name: "Match A" }, [121.5228, 25.0528]);
    const offScreen = place("off-screen", { name: "Match B" }, [121.5236, 25.0478]);
    const answer = search("match", { tier2Features: [offScreen, onScreen] });
    expect(answer.hits.map((h) => h.id)).toEqual(["on-screen", "off-screen"]);
    expect(answer.hits.map((h) => h.inView)).toEqual([true, false]);
    // Stated rather than assumed: the first row really is the further one.
    expect(answer.hits[0].distanceM).toBeGreaterThan(answer.hits[1].distanceM);
  });

  it("orders each group by distance, without letting a near miss jump the group", () => {
    // Both keys at once. Within a group distance decides (in-1 before in-2,
    // near-out before far-out); across groups it does not — `near-out` at
    // ~614 m is nearer than `in-2` at ~771 m and still sorts below it,
    // because it is off screen.
    const answer = search("match", {
      tier2Features: [
        place("far-out", { name: "Match" }, east(9)),
        place("in-2", { name: "Match" }, [121.5228, 25.0528]),
        place("near-out", { name: "Match" }, [121.5236, 25.0478]),
        place("in-1", { name: "Match" }, [121.5185, 25.048]),
      ],
    });
    expect(answer.hits.map((h) => h.id)).toEqual(["in-1", "in-2", "near-out", "far-out"]);
    expect(answer.hits.map((h) => h.inView)).toEqual([true, true, false, false]);
    expect(answer.hits[0].distanceM).toBeLessThan(answer.hits[1].distanceM);
    expect(answer.hits[2].distanceM).toBeLessThan(answer.hits[3].distanceM);
    // The crossing pair, without which the group key would be free to vanish.
    expect(answer.hits[2].distanceM).toBeLessThan(answer.hits[1].distanceM);
  });

  it("ranks by distance alone when the map has not reported a viewport yet", () => {
    // `bounds` is null until the map has rendered once. Nothing is "in view"
    // then, and the box must still answer rather than rank on a guess.
    const answer = search("match", {
      bounds: null,
      tier2Features: [place("b", { name: "Match" }, east(3)), place("a", { name: "Match" })],
    });
    expect(answer.hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(answer.hits.every((h) => h.inView === false)).toBe(true);
  });

  it("caps the rows and counts the rest, so the dropdown never lies about its own length", () => {
    // A cap that quietly dropped the remainder would tell a person searching
    // "7" that this map has eight of them.
    const many = Array.from({ length: 12 }, (_, i) =>
      place(`m${i}`, { name: `Match ${i}` }, east(i + 1)),
    );
    const answer = search("match", { tier2Features: many });
    expect(answer.hits).toHaveLength(SEARCH_LIMIT);
    expect(answer.total).toBe(12);
    expect(answer.overflow).toBe(12 - SEARCH_LIMIT);
  });

  it("reports no overflow when everything matched fits", () => {
    const answer = search("match", { tier2Features: [place("m", { name: "Match" })] });
    expect(answer.total).toBe(1);
    expect(answer.overflow).toBe(0);
  });

  it("counts the kinds of place it could not search", () => {
    // The honesty line: "nothing matched" and "that file was never fetched"
    // must never look the same to a person who has no agent to ask.
    expect(search("x").unfetchedCategories).toBe(TIER2_CATEGORIES.length);
    expect(search("x", { loaded: ["cafe", "bakery"] }).unfetchedCategories).toBe(
      TIER2_CATEGORIES.length - 2,
    );
    // It is a fact about the map, not about the query: reported even when the
    // box has nothing to search yet.
    expect(search("").unfetchedCategories).toBe(TIER2_CATEGORIES.length);
  });

  it("dresses a row with the map's own colour and word for what it is", () => {
    const [park] = search("green", {
      features: [place("p", { name: "Green Park", category: "park" })],
    }).hits;
    expect(park.what).toBe("Park");
    expect(park.swatch).toBe("#2f9e44");
    const [cafe] = search("green", {
      tier2Features: [place("c", { name: "Green Cafe", category: "cafe" })],
    }).hits;
    expect(cafe.what).toBe("Cafe");
    // POIs have no colour in the map's ramp, so they take the card's grey.
    expect(cafe.swatch).not.toBe(park.swatch);
  });

  it("shows the English name only when it says something the title does not", () => {
    const both = place("a", { name: "大安森林公園", nameEn: "Da-an Forest Park" });
    const same = place("b", { name: "Louisa Coffee", nameEn: "louisa coffee" });
    expect(search("公園", { features: [both] }).hits[0].nameEn).toBe("Da-an Forest Park");
    expect(search("louisa", { tier2Features: [same] }).hits[0].nameEn).toBeUndefined();
  });

  it("titles a nameless place with the word that found it", () => {
    // 31% of the POI extract carries a brand and many carry no name at all;
    // a row reading `osm:node:12345` is a row nobody can act on.
    const nameless = place("osm:node:12345", { name: "", brand: "7-Eleven" });
    expect(search("7-eleven", { tier2Features: [nameless] }).hits[0].name).toBe("7-Eleven");
  });

  it("keeps one row per place when a bundled feature and a POI share an id", () => {
    const bundled = place("dup", { name: "Shared Name", category: "supermarket" });
    const poi = place("dup", { name: "Shared Name", category: "convenience" });
    const answer = search("shared", { features: [bundled], tier2Features: [poi] });
    expect(answer.total).toBe(1);
    // The painted feature wins, exactly as the sidebar resolves it.
    expect(answer.hits[0].category).toBe("supermarket");
  });

  it("does not offer a place it could not fly to", () => {
    // Every row's job is to move the camera; a broken geometry has nowhere to
    // move it to, so it is left out rather than offered and inert.
    const broken = {
      type: "Feature",
      geometry: null,
      properties: { id: "broken", name: "Match", category: "cafe", source: "osm" },
    } as unknown as MapFeature;
    expect(search("match", { tier2Features: [broken] }).total).toBe(0);
  });
});

/**
 * The two halves of one dropdown.
 *
 * They search different things — what the map is holding, and what the city has
 * — and a person reading the list cannot see the seam between them. So they may
 * differ in what they *offer* (a loaded row is selectable, a citywide one has to
 * be fetched first) and must never differ in what they *match*: one word, one
 * set of columns, whichever side of the line the place happens to be on. Since
 * T-102 that set is `QUERY_FIELDS` on both, and on the tools as well.
 */
describe("the box's two lists read the same columns", () => {
  /** A word no fixture carries anywhere except in the field under test. */
  const NEEDLE = "zebra";

  /** The needle in exactly one column; every other column says nothing. */
  const only = (field: (typeof QUERY_FIELDS)[number], value: string) => {
    switch (field) {
      case "name":
        return { name: value };
      case "nameEn":
        return { name: "無名", nameEn: value };
      case "brand":
        return { name: "無名", brand: value };
      case "cuisine":
        return { name: "無名", cuisine: value };
      case "address":
        return { name: "無名", address: value };
    }
  };

  const inIndex = (query: string, entries: SearchIndexEntry[]) =>
    searchIndexEntries({
      index: entries,
      query,
      bounds: VIEW,
      origin: ORIGIN,
      loadedCategories: [],
    });

  // Every shared column, one test each, so a field dropped from either matcher
  // fails here by name rather than as a mysterious count.
  for (const field of QUERY_FIELDS) {
    it(`finds a place matched only by its ${field}, in the loaded list and the citywide one`, () => {
      const fields = only(field, `${NEEDLE} corner`);
      const loaded = search(NEEDLE, {
        tier2Features: [place("osm:node:7", { ...fields, category: "cafe" })],
      });
      const citywide = inIndex(NEEDLE, [
        { id: "osm:node:7", categories: ["cafe"], lng: ORIGIN[0], lat: ORIGIN[1], ...fields },
      ]);
      expect(loaded.hits.map((h) => h.id)).toEqual(["osm:node:7"]);
      expect(citywide.hits.map((h) => h.id)).toEqual(["osm:node:7"]);
    });
  }

  it("answers a street name the same way for a place it holds and one it does not", () => {
    // The two-list disagreement T-102 fixed, in one assertion: the same id, the
    // same address, the same word — and before the fix only the citywide half
    // came back, which read to a person as "the map cannot see what it is
    // already showing me".
    const address = "臺北市士林區基河路 130 號";
    const entry: SearchIndexEntry = {
      id: "osm:node:9",
      name: "無名",
      address,
      categories: ["cafe"],
      lng: ORIGIN[0],
      lat: ORIGIN[1],
    };
    const loaded = search("基河路", {
      tier2Features: [place(entry.id, { name: entry.name, address, category: "cafe" })],
    });
    const citywide = inIndex("基河路", [entry]);
    expect(loaded.hits.map((h) => h.id)).toEqual([entry.id]);
    expect(citywide.hits.map((h) => h.id)).toEqual(loaded.hits.map((h) => h.id));
    // Which list a place lands in is still a difference, and a deliberate one:
    // once its category is in memory the citywide half stops offering it, so
    // the dropdown never shows the same place twice.
    expect(
      searchIndexEntries({
        index: [entry],
        query: "基河路",
        bounds: VIEW,
        origin: ORIGIN,
        loadedCategories: ["cafe"],
      }).total,
    ).toBe(0);
  });
});

/**
 * The dropdown holds three kinds of answer, and the order they are read in is
 * a promise about what each one costs. These tests are that promise.
 */
describe("composeSearchRows", () => {
  const loaded = (id: string, distanceM: number): SearchHit => ({
    id,
    name: id,
    category: "cafe",
    what: "Cafe",
    swatch: "#888",
    center: ORIGIN,
    distanceM,
    inView: false,
  });
  const citywide = (id: string, distanceM: number): IndexHit => ({
    id,
    name: id,
    category: "cafe",
    what: "Cafe",
    center: ORIGIN,
    distanceM,
    inView: true,
  });
  const kind: CategoryRow = { category: "cafe", label: "Cafés", zh: "咖啡廳", count: 2297 };

  it("puts every loaded place above every citywide one, however far away", () => {
    // The precedence is absolute, not a score. The loaded row is 4 km out and
    // off screen; the index row is 200 m away and on screen — and the index
    // row still sorts below it, because accepting it downloads a category file
    // before the map can show anything. Ranking the two lists together by
    // distance would make the *nearer* answer the one that makes you wait.
    const rows = composeSearchRows([loaded("far", 4000)], [citywide("near", 200)], []);
    expect(rows.map((r) => r.kind)).toEqual(["loaded", "index"]);
  });

  it("puts the kinds last, because an offer is broader than any result", () => {
    const rows = composeSearchRows([loaded("a", 10)], [citywide("b", 20)], [kind]);
    expect(rows.map((r) => r.kind)).toEqual(["loaded", "index", "category"]);
  });

  it("keys every row uniquely, so one place cannot collide with its own offer", () => {
    // The index never offers a place whose category is loaded, so this cannot
    // happen today — the keys do not depend on that staying true.
    const rows = composeSearchRows([loaded("same", 10)], [citywide("same", 20)], [kind]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("is empty only when all three lists are", () => {
    expect(composeSearchRows([], [], [])).toEqual([]);
    expect(composeSearchRows([], [], [kind])).toHaveLength(1);
  });
});

/**
 * The empty state is the box's one chance to be honest about its own reach:
 * "nothing matches" and "the file was never fetched" must never look the same.
 */
describe("searchEmptyNote", () => {
  const note = (status: SearchIndexStatus, unfetched = 18) => searchEmptyNote(status, unfetched);

  it("claims the whole city only once the index is actually in hand", () => {
    // With 31,057 rows across all 18 categories read, a miss really is a miss
    // — this is the only state in which the box may say so.
    expect(note("ready")).toBe("Nothing in Taipei matches that.");
  });

  it("says it is still looking rather than that it found nothing", () => {
    // The window between the first keystroke and a 3.5 MB file arriving is
    // where a premature "no results" would be a lie the person acts on.
    expect(note("loading")).toContain("Still looking");
  });

  it("admits a failed index, and points at the retry it actually has", () => {
    // `loadSearchIndex` retries a failure, and the only retry signal this
    // surface has is the next keystroke — so the sentence says so.
    expect(note("failed")).toContain("citywide index did not arrive");
    expect(note("failed")).toContain("Keep typing");
  });

  it("falls back to the tray pointer when there is no index to speak for", () => {
    // `idle` (nobody asked yet) and `absent` (this build ships none) are both
    // "the box can only speak for what it has" — the pre-T-100 sentence, which
    // is still the honest one.
    for (const status of ["idle", "absent"] as const) {
      expect(note(status)).toBe(
        "Nothing loaded matches that — 18 more kinds of place load from the Places tray.",
      );
      expect(searchEmptyNote(status, 0)).toBe("Nothing on this map matches that.");
    }
  });
});

describe("formatDistance", () => {
  it("is exact under a kilometre and one decimal above it", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(320.4)).toBe("320 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(12345)).toBe("12.3 km");
  });
});
