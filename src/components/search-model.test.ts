import { describe, expect, it } from "vitest";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import { TIER2_CATEGORIES, type MapCategory, type MapFeature } from "@/lib/store/tier2";
import { SEARCH_LIMIT, formatDistance, searchLoadedFeatures } from "./search-model";

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
  it("matches all four fields a person might type, in any case", () => {
    // The whole reason this matcher is not the tools'. A person types the word
    // in their head; three of these four words are not the place's name.
    const features = [
      place("named", { name: "台北車站", nameEn: "Taipei Main Station", category: "mrt_station" }),
      place("branded", { name: "全家", brand: "FamilyMart", category: "convenience" }),
      place("cooked", { name: "無名小吃", cuisine: "vegetarian;taiwanese", category: "restaurant" }),
    ];
    expect(search("台北車", { features }).hits.map((h) => h.id)).toEqual(["named"]);
    expect(search("taipei main", { features }).hits.map((h) => h.id)).toEqual(["named"]);
    expect(search("familymart", { features }).hits.map((h) => h.id)).toEqual(["branded"]);
    expect(search("VEGETARIAN", { features }).hits.map((h) => h.id)).toEqual(["cooked"]);
  });

  it("finds a place by a word the tools' query would miss", () => {
    // The divergence, stated as a test rather than only as a comment: a café
    // whose name says nothing about coffee is still what "coffee" means.
    const cafe = place("osm:node:1", { name: "路易莎", cuisine: "coffee_shop" });
    expect(search("coffee", { tier2Features: [cafe] }).total).toBe(1);
    // ...and the name matcher still works on the same feature, unchanged.
    expect(search("路易莎", { tier2Features: [cafe] }).total).toBe(1);
  });

  it("folds spelling the way the tools do, so one map has one answer", () => {
    // `normaliseName` is shared with the gazetteer on purpose: OSM writes
    // "Da-an Forest Park" and people type "Daan". Only the field set diverges.
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

  it("puts what you can see first, however much closer the rest is", () => {
    // The ranking rule that makes the box feel like it is about *this* map:
    // a match on screen outranks a nearer one that has scrolled off. `far` is
    // inside the view but at its edge; `near` is 3 km east of the centre.
    const inViewEdge = place("far", { name: "Match A" }, [121.5225, 25.0525]);
    const outOfView = place("near", { name: "Match B" }, east(3));
    const answer = search("match", { tier2Features: [outOfView, inViewEdge] });
    expect(answer.hits.map((h) => h.id)).toEqual(["far", "near"]);
    expect(answer.hits.map((h) => h.inView)).toEqual([true, false]);
  });

  it("orders each group by distance from the view centre", () => {
    const answer = search("match", {
      tier2Features: [
        place("far-out", { name: "Match" }, east(9)),
        place("in-2", { name: "Match" }, [121.5205, 25.048]),
        place("near-out", { name: "Match" }, east(3)),
        place("in-1", { name: "Match" }, [121.5185, 25.048]),
      ],
    });
    expect(answer.hits.map((h) => h.id)).toEqual(["in-1", "in-2", "near-out", "far-out"]);
    expect(answer.hits[0].distanceM).toBeLessThan(answer.hits[1].distanceM);
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

describe("formatDistance", () => {
  it("is exact under a kilometre and one decimal above it", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(320.4)).toBe("320 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(12345)).toBe("12.3 km");
  });
});
