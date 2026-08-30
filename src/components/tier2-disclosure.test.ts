import { describe, expect, it } from "vitest";
import type { MapCategory, MapFeature } from "@/lib/store/tier2";
import { loadedCategoryRows } from "./tier2-disclosure";

const poi = (id: string, category: MapCategory, categories?: MapCategory[]): MapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [121.54, 25.03] },
  properties: { id, name: id, category, source: "osm", ...(categories ? { categories } : {}) },
});

/**
 * The disclosure exists because tier-2 is invisible: loading a category adds
 * thousands of searchable places and changes nothing on screen. If the number
 * it prints were wrong, the row would be worse than absent — it would be a
 * confident answer to "what can this thing search?" that is not true.
 */
describe("loadedCategoryRows", () => {
  it("shows nothing before any category is loaded", () => {
    // The landing state has to be untouched: no chrome, no reserved space.
    expect(loadedCategoryRows([], [])).toEqual([]);
  });

  it("counts what is in the store, category by category", () => {
    const rows = loadedCategoryRows(
      ["cafe", "pharmacy"],
      [poi("a", "cafe"), poi("b", "cafe"), poi("c", "pharmacy")],
    );
    expect(rows).toEqual([
      { category: "cafe", count: 2 },
      { category: "pharmacy", count: 1 },
    ]);
  });

  it("counts a dual-tagged place under both of its categories", () => {
    // The store keeps one feature per id and records the other categories on
    // it, so a bakery that is also a fast-food counter answers either query.
    // Counting it once would make the cafe row under-report what a search of
    // that category would actually find.
    const rows = loadedCategoryRows(
      ["bakery", "fast_food"],
      [poi("a", "bakery", ["bakery", "fast_food"])],
    );
    expect(rows).toEqual([
      { category: "bakery", count: 1 },
      { category: "fast_food", count: 1 },
    ]);
  });

  it("reports zero rather than dropping a category that loaded empty", () => {
    // "cafe 0" is information — the file arrived and had nothing. A missing
    // row would read as "not loaded", which is a different fact entirely.
    expect(loadedCategoryRows(["cafe"], [])).toEqual([{ category: "cafe", count: 0 }]);
  });

  it("ignores features of categories that are not being disclosed", () => {
    expect(loadedCategoryRows(["cafe"], [poi("a", "cafe"), poi("b", "bar")])).toEqual([
      { category: "cafe", count: 1 },
    ]);
  });

  it("follows the store's order, not the order the features arrived in", () => {
    // `tier2Loaded` is sorted by the store precisely so that nothing on screen
    // reveals which category the agent happened to ask for first.
    const rows = loadedCategoryRows(["bar", "cafe"], [poi("a", "cafe"), poi("b", "bar")]);
    expect(rows.map((r) => r.category)).toEqual(["bar", "cafe"]);
  });
});
