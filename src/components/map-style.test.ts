import { describe, expect, it } from "vitest";
import { FEATURE_CATEGORIES } from "@/lib/data/schema";
import { INTERACTIVE_LAYER_IDS, buildLayerSpecs, sourceId } from "./map-style";

/**
 * map-style.ts is pure, and these three properties are what the rest of T-03
 * relies on: selection highlighting keys on properties.id, clicks must never
 * hit label layers, and every category must have somewhere to render.
 */
describe("buildLayerSpecs", () => {
  it("highlights the selected features by matching properties.id", () => {
    const selection = ["osm:way:1", "listing:02"];
    const specs = buildLayerSpecs(selection);
    // The selection reaches the layers as an ["in", ["get","id"], [literal ...]]
    // expression, so tools that write store.selection light up the right pixels.
    const wanted = JSON.stringify(["in", ["get", "id"], ["literal", selection]]);
    expect(JSON.stringify(specs)).toContain(wanted);
  });

  it("carries the current selection, not a stale one", () => {
    // An empty selection must still key on id (with an empty literal), otherwise
    // deselection could never clear a highlight.
    expect(JSON.stringify(buildLayerSpecs([]))).toContain(
      JSON.stringify(["in", ["get", "id"], ["literal", []]]),
    );
  });

  it("gives every category a source to render into", () => {
    const specs = buildLayerSpecs([]);
    for (const category of FEATURE_CATEGORIES) {
      const src = sourceId(category);
      expect(specs.some((l) => (l as { source?: string }).source === src)).toBe(true);
    }
  });
});

describe("INTERACTIVE_LAYER_IDS", () => {
  it("excludes symbol/label layers so a click never lands on a label", () => {
    const symbolIds = new Set(
      buildLayerSpecs([])
        .filter((l) => l.type === "symbol")
        .map((l) => l.id),
    );
    expect(symbolIds.size).toBeGreaterThan(0);
    for (const id of INTERACTIVE_LAYER_IDS) expect(symbolIds.has(id)).toBe(false);
  });

  it("is exactly the non-symbol layers", () => {
    const nonSymbol = buildLayerSpecs([])
      .filter((l) => l.type !== "symbol")
      .map((l) => l.id);
    expect(INTERACTIVE_LAYER_IDS).toEqual(nonSymbol);
  });
});
