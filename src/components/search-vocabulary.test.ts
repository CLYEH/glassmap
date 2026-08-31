import { describe, expect, it } from "vitest";
import { TIER2_CATEGORIES, type MapCategory, type Tier2Category } from "@/lib/store/tier2";
import { TIER2_PLURAL, TIER2_SINGULAR } from "./category-labels";
import {
  CATEGORY_VOCABULARY,
  SEARCH_CATEGORY_LIMIT,
  matchCategoryVocabulary,
} from "./search-vocabulary";

const counts = (entries: Partial<Record<Tier2Category, number>>): Map<MapCategory, number> =>
  new Map(Object.entries(entries) as [MapCategory, number][]);

const match = (
  query: string,
  options: {
    counts?: Map<MapCategory, number>;
    painted?: Tier2Category[];
    limit?: number;
  } = {},
) =>
  matchCategoryVocabulary({
    query,
    counts: options.counts ?? new Map(),
    painted: options.painted ?? [],
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });

/**
 * The vocabulary is the box's answer to a question that has no answer in the
 * data: "coffee" is not the name of anywhere. Everything here is about the two
 * ways that offer goes wrong — missing the word a person in Taipei would type,
 * or offering to repaint the city because they typed one letter.
 */
describe("matchCategoryVocabulary", () => {
  it("covers all 18 kinds, each with the tray's own English word", () => {
    // The table and the tray must not drift: a row saying "Cafés" and a chip
    // saying something else are two names for one act, and the person is
    // supposed to recognise the second from the first.
    expect(CATEGORY_VOCABULARY.map((e) => e.category).sort()).toEqual(
      [...TIER2_CATEGORIES].sort(),
    );
    for (const entry of CATEGORY_VOCABULARY) {
      expect(entry.en).toBe(TIER2_PLURAL[entry.category]);
      expect(entry.zh).not.toBe("");
    }
  });

  it("reaches a kind through the word a person here would actually type", () => {
    // Each of these is a word that finds almost nothing as a NAME: the point
    // of the table is that the answer is the category, not the four shops that
    // happen to be called it.
    const cases: [string, Tier2Category][] = [
      ["咖啡", "cafe"],
      ["藥局", "pharmacy"],
      ["超商", "convenience"],
      ["停車", "parking"],
      ["派出所", "police"],
      ["ubike", "bicycle_rental"],
      ["郵局", "post_office"],
      ["廟", "place_of_worship"],
    ];
    for (const [query, category] of cases) {
      expect(match(query).map((row) => row.category), query).toContain(category);
    }
  });

  it("reaches the kinds whose English label cannot be typed", () => {
    // "Cafés" cannot be reached by typing "cafe" — `normaliseName` folds
    // punctuation and case, never accents — and nobody types "Worship" looking
    // for a temple. Both gaps are closed by aliases, not by changing the words
    // the tray shows.
    expect(match("cafe")[0].category).toBe("cafe");
    expect(match("coffee")[0].category).toBe("cafe");
    expect(match("temple")[0].category).toBe("place_of_worship");
  });

  it("answers to every word this app itself uses for a kind", () => {
    // The invariant that caught the real gap: matching is by prefix, so a
    // plural English does not build by adding a letter is unreachable from its
    // own singular — "Pharmacies" was not found by typing "pharmacy", over a
    // city holding 1,100 of them. The map teaches a person both words (the
    // tray shows the plural, a selected row shows the singular), so both have
    // to work, and a nineteenth category cannot be added without checking it.
    for (const category of TIER2_CATEGORIES) {
      for (const word of [TIER2_SINGULAR[category], TIER2_PLURAL[category]]) {
        expect(match(word, { limit: 99 }).map((r) => r.category), word).toContain(category);
      }
    }
  });

  it("matches the start of a word, so the offer appears while it is typed", () => {
    // Prefix and not substring: an offer that only arrives on the last letter
    // is an offer nobody sees, and a substring match would paint every
    // restaurant for a query that merely occurs inside "Restaurants".
    expect(match("pharmac")[0].category).toBe("pharmacy");
    expect(match("咖")[0].category).toBe("cafe");
    // "urant" occurs inside "Restaurants" and reaches nothing.
    expect(match("urant")).toEqual([]);
  });

  it("holds its tongue for a single Latin letter, and speaks for a single Han one", () => {
    // "b" prefixes Bakeries, Banks, Bars and Bike share: four kinds means the
    // person has not named a kind. One Han character is a whole word.
    expect(match("b")).toEqual([]);
    expect(match("c")).toEqual([]);
    expect(match("廟").map((row) => row.category)).toEqual(["place_of_worship"]);
  });

  it("puts a word typed in full first, then the bigger kind", () => {
    // "po" starts both "Post offices" and "Police", and neither in full, so the
    // larger kind leads — the same rule the tool's `unloaded_matches` ranks by.
    const tally = counts({ police: 100, post_office: 500 });
    expect(match("po", { counts: tally }).map((r) => r.category)).toEqual([
      "post_office",
      "police",
    ]);
    // Typed in full, the smaller kind wins anyway: somebody who wrote the whole
    // word meant the whole word, whatever else merely starts with it.
    expect(match("police", { counts: tally }).map((r) => r.category)).toEqual(["police"]);
  });

  it("offers at most two kinds, because a third is not an identification", () => {
    // "ba" starts Bakeries, Bars and Banks. Three kinds is a person still
    // typing; the cap is what keeps the offer under the results rather than
    // instead of them.
    expect(SEARCH_CATEGORY_LIMIT).toBe(2);
    expect(match("ba", { limit: 99 })).toHaveLength(3);
    expect(match("ba")).toHaveLength(SEARCH_CATEGORY_LIMIT);
  });

  it("does not offer to browse what is already painted", () => {
    // Picking it would toggle the category OFF, which is the opposite of what
    // the row says. An offer to do nothing is worse than no offer.
    expect(match("咖啡").map((r) => r.category)).toEqual(["cafe"]);
    expect(match("咖啡", { painted: ["cafe"] })).toEqual([]);
  });

  it("says '…' rather than zero when nothing has counted the file yet", () => {
    // The tray's own convention. A zero here would be a claim about a file
    // nobody has opened — the exact lie the tier-2 disclosure exists to stop.
    expect(match("咖啡")[0].count).toBeNull();
    expect(match("咖啡", { counts: counts({ cafe: 2297 }) })[0].count).toBe(2297);
  });

  it("is not a search at all until something is typed", () => {
    for (const query of ["", "   ", "\t"]) expect(match(query)).toEqual([]);
  });

  it("keeps food out of the table — that is the feature matcher's job", () => {
    // `cuisine` values belong to the places that carry them. Offering to paint
    // 12,000 restaurants because somebody typed "ramen" answers a question
    // nobody asked, and hides the ramen shop two streets away.
    expect(match("ramen")).toEqual([]);
    expect(match("sushi")).toEqual([]);
    expect(match("拉麵")).toEqual([]);
  });
});
