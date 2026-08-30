import { describe, expect, it } from "vitest";
import { FEATURE_CATEGORIES } from "@/lib/data/schema";
import { TIER2_CATEGORIES } from "@/lib/store/tier2";
import { CATEGORY_SINGULAR, TIER2_SINGULAR, categorySingular } from "./category-labels";

/**
 * A selected row's one job is to say what kind of place it names. The two
 * vocabularies are kept in separate maps so each keeps its own compile-time
 * exhaustiveness check; these tests cover what the types cannot — that the
 * lookup is total at runtime, and that the words are for people.
 */
describe("categorySingular", () => {
  it("answers for every category a loaded feature can carry", () => {
    for (const category of [...FEATURE_CATEGORIES, ...TIER2_CATEGORIES]) {
      expect(categorySingular(category)).toBeTruthy();
    }
  });

  it("routes each vocabulary to its own map", () => {
    expect(categorySingular("park")).toBe(CATEGORY_SINGULAR.park);
    expect(categorySingular("cafe")).toBe(TIER2_SINGULAR.cafe);
  });

  it("never prints a raw OSM tag at a human", () => {
    // The enum values are the agent's vocabulary and belong in the mono
    // disclosure row; a sidebar row that said "fast_food" or "place_of_worship"
    // would be the tool talking, in the one place the product speaks English.
    for (const category of TIER2_CATEGORIES) {
      const label = categorySingular(category);
      expect(label).not.toContain("_");
      if (category.includes("_")) expect(label).not.toBe(category);
    }
  });
});
