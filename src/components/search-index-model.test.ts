import { describe, expect, it } from "vitest";
import { QUERY_FIELDS } from "@/lib/map-tools/query";
import type { Bounds, LngLat } from "@/lib/store/map-store";
import type { SearchIndexEntry } from "@/lib/store/search-index";
import type { Tier2Category } from "@/lib/store/tier2";
import {
  SEARCH_INDEX_LIMIT,
  searchHaystack,
  searchIndexEntries,
} from "./search-index-model";

/** Taipei Main Station, the default view centre. */
const ORIGIN: LngLat = [121.5175, 25.0478];
/** A tight box around the origin: ~1.1 km across, so "in view" is a real filter. */
const VIEW: Bounds = [121.512, 25.043, 121.523, 25.053];

const row = (
  id: string,
  fields: Partial<SearchIndexEntry> = {},
  at: LngLat = ORIGIN,
): SearchIndexEntry => ({
  id,
  name: fields.name ?? id,
  categories: fields.categories ?? ["cafe"],
  lng: fields.lng ?? at[0],
  lat: fields.lat ?? at[1],
  ...(fields.nameEn ? { nameEn: fields.nameEn } : {}),
  ...(fields.brand ? { brand: fields.brand } : {}),
  ...(fields.cuisine ? { cuisine: fields.cuisine } : {}),
  ...(fields.address ? { address: fields.address } : {}),
});

/** Roughly `km` east of the origin — enough to leave the 1 km-wide view. */
const east = (km: number): LngLat => [ORIGIN[0] + km * 0.0099, ORIGIN[1]];

const search = (
  query: string,
  options: {
    index?: SearchIndexEntry[] | null;
    bounds?: Bounds | null;
    loaded?: Tier2Category[];
    limit?: number;
  } = {},
) =>
  searchIndexEntries({
    index: options.index === undefined ? [] : options.index,
    query,
    bounds: options.bounds === undefined ? VIEW : options.bounds,
    origin: ORIGIN,
    loadedCategories: options.loaded ?? [],
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });

/**
 * The citywide half of the search box. Everything here is about the promise it
 * makes and the two ways that promise breaks: offering a place the map cannot
 * reach, or staying silent about a place the city plainly has.
 */
describe("searchIndexEntries", () => {
  it("finds a place in a category nobody has loaded — the whole reason it exists", () => {
    // The reported defect, as a test: "starbucks" on a fresh page found
    // nothing, over a city holding 152 Starbucks — 151 of them reachable by
    // that word — in a file never fetched.
    const index = [row("osm:node:1", { name: "Starbucks", brand: "Starbucks" })];
    const answer = search("starbucks", { index });
    expect(answer.total).toBe(1);
    expect(answer.hits[0].category).toBe("cafe");
    expect(answer.hits[0].what).toBe("Cafe");
  });

  it("matches every column a person might type, not just the name", () => {
    // The five columns of `QUERY_FIELDS` — since T-102 the same five every
    // other surface reads, so a word that finds a row here finds the feature
    // once its category is loaded, and finds it through a tool call too.
    const index = [
      row("named", { name: "星巴克", nameEn: "Starbucks" }),
      row("branded", { name: "無名", brand: "Louisa Coffee" }),
      row("cooked", { name: "小店", cuisine: "coffee_shop" }),
      row("addressed", { name: "小店二號", address: "臺北市士林區基河路 130 號" }),
    ];
    expect(search("starbucks", { index }).hits.map((h) => h.id)).toEqual(["named"]);
    expect(search("louisa", { index }).hits.map((h) => h.id)).toEqual(["branded"]);
    expect(search("coffee", { index }).total).toBe(2); // brand and cuisine both
    expect(search("基河路", { index }).hits.map((h) => h.id)).toEqual(["addressed"]);
  });

  it("never matches across the boundary between two fields", () => {
    // The haystack joins the columns into one string, so this is the one way
    // that could invent a match: a needle spanning the end of the name and the
    // start of the address would find a place nobody named.
    const index = [row("a", { name: "Cama", address: "Coffee Street 1" })];
    expect(search("cama", { index }).total).toBe(1);
    expect(search("coffee", { index }).total).toBe(1);
    expect(search("cama coffee", { index }).total).toBe(0);
  });

  it("leaves out anything whose category is already in memory", () => {
    // The rule `unloadedMatches` uses, and for the same reason: those places
    // are already offered above as real, selectable features. Without it the
    // same café appears twice — once rich, once as an offer to fetch a file
    // that is already here.
    const index = [
      row("loaded-one", { name: "Match", categories: ["cafe"] }),
      row("not-loaded", { name: "Match", categories: ["bakery"] }),
      // Dual-tagged: one of its two files is in memory, so it is not missing.
      row("dual", { name: "Match", categories: ["bar", "cafe"] }),
    ];
    expect(search("match", { index, loaded: ["cafe"] }).hits.map((h) => h.id)).toEqual([
      "not-loaded",
    ]);
  });

  it("offers the category a pick would actually load", () => {
    // The row says "Bar" and picking it loads `bar`: the first of the sorted
    // set, which is what `mergeTier2` will report once the file is in memory.
    // A row promising one word and loading another is a row that lies twice.
    const index = [row("dual", { name: "Match", categories: ["bar", "cafe"] })];
    expect(search("match", { index }).hits[0].category).toBe("bar");
  });

  it("says nothing at all when this page has no index", () => {
    // Never asked, still arriving, unreadable, never shipped — the store
    // reports all four as null, and every consumer degrades by saying less.
    // The BOX says which it is (`searchEmptyNote`); this list simply is empty.
    const answer = search("starbucks", { index: null });
    expect(answer).toEqual({ hits: [], total: 0, overflow: 0 });
  });

  it("ranks exactly as the loaded list does: on screen first, then nearest", () => {
    // One order across both lists, so they read as one list with a line
    // through it. `near-out` is nearer than `in-2` and still sorts below it.
    const index = [
      row("far-out", { name: "Match" }, east(9)),
      row("in-2", { name: "Match" }, [121.5228, 25.0528]),
      row("near-out", { name: "Match" }, [121.5236, 25.0478]),
      row("in-1", { name: "Match" }, [121.5185, 25.048]),
    ];
    const answer = search("match", { index });
    expect(answer.hits.map((h) => h.id)).toEqual(["in-1", "in-2", "near-out", "far-out"]);
    expect(answer.hits[2].distanceM).toBeLessThan(answer.hits[1].distanceM);
  });

  it("caps the rows and counts the rest, so the list never lies about the city", () => {
    // A cap that dropped the remainder would tell somebody searching a chain
    // that Taipei has six of them.
    const index = Array.from({ length: 10 }, (_, i) =>
      row(`m${i}`, { name: `Match ${i}` }, east(i + 1)),
    );
    const answer = search("match", { index });
    expect(answer.hits).toHaveLength(SEARCH_INDEX_LIMIT);
    expect(answer.total).toBe(10);
    expect(answer.overflow).toBe(10 - SEARCH_INDEX_LIMIT);
  });

  it("is not a search at all until something is typed", () => {
    for (const query of ["", "  ", "\t"]) {
      expect(search(query, { index: [row("a")] }).total).toBe(0);
    }
  });

  it("folds spelling the way the tools do, so one map has one answer", () => {
    // `normaliseName` is shared with the gazetteer, and since T-102 the field
    // set is shared too: one folding, one column set, one answer.
    const index = [row("p", { name: "Da-an Coffee" })];
    expect(search("daan coffee", { index }).total).toBe(1);
    expect(search("DAAN COFFEE", { index }).total).toBe(1);
  });
});

describe("searchHaystack", () => {
  it("folds each index array exactly once, and keys the cache on the array", () => {
    // The measured reason this cache exists: normalising 31,057 rows per
    // keystroke costs ~50 ms, and the box has to answer between two letters.
    // Identity is what makes it correct — the store hands the same array to
    // every render, and a different array is a different index.
    const index = [row("a", { name: "Alpha" })];
    const first = searchHaystack(index);
    expect(searchHaystack(index)).toBe(first);

    const other = [row("a", { name: "Alpha" })];
    expect(searchHaystack(other)).not.toBe(first);
    expect(searchHaystack(other)).toEqual(first);
  });

  it("holds every searchable column, folded, one row per entry", () => {
    const index = [
      row("a", { name: "Louisa", nameEn: "Louisa Coffee", brand: "Louisa", cuisine: "coffee_shop", address: "No. 1" }),
      row("b", { name: "Bare" }),
    ];
    const hay = searchHaystack(index);
    expect(hay).toHaveLength(2);
    // Folded (lower-cased, punctuation dropped) and newline-separated, so no
    // needle can span two columns.
    expect(hay[0]).toBe("louisa\nlouisa coffee\nlouisa\ncoffee_shop\nno 1");
    // One line per shared column, in `QUERY_FIELDS` order. This goes red the
    // day the predicate gains a column and this fixture stops populating it —
    // which is the moment to check that the citywide list still reads all of
    // them, not the moment to loosen the assertion above.
    expect(hay[0].split("\n")).toHaveLength(QUERY_FIELDS.length);
    // Absent columns leave nothing behind — an empty line would let a one-space
    // needle match every row that happens to be missing a brand.
    expect(hay[1]).toBe("bare");
  });
});
