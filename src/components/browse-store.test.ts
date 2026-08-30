import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category, Tier2RestoreResult } from "@/lib/store/tier2";
import { useBrowseStore } from "./browse-store";

const browse = () => useBrowseStore.getState();

const realRestore = useMapStore.getState().restoreTier2Categories;

/** The loader, stubbed: what browsing does with the answer is what is on test. */
const restoreReturns = (ok: boolean) =>
  useMapStore.setState({
    restoreTier2Categories: async (categories: readonly Tier2Category[]) =>
      ({ ok, loaded: ok ? [...categories] : [], failed: [] }) satisfies Tier2RestoreResult,
  });

describe("browse store", () => {
  beforeEach(() => {
    useBrowseStore.setState({
      category: null,
      loading: false,
      threshold: Number.POSITIVE_INFINITY,
    });
    restoreReturns(true);
  });

  afterEach(() => useMapStore.setState({ restoreTier2Categories: realRestore }));

  it("paints nothing when the category's file never arrived", async () => {
    // "No cafes here" and "the cafe file did not load" must never look the
    // same: an empty layer under a category name is a claim about the city.
    restoreReturns(false);
    await browse().browse("cafe");
    expect(browse().category).toBeNull();
    expect(browse().loading).toBe(false);
  });

  it("leaves the ink budget to the map, across a category switch", async () => {
    // The regression this file exists for. The map republishes the threshold
    // only when it *changes* — setting the same filter repaints, which fires
    // `idle`, which re-enters the budget pass — so a store-side reset the map
    // cannot see survives: switch to a category whose budget lands on the same
    // number and the store says "none counted" while the layer filter is still
    // counting at 27, i.e. `browse-state` prints "counted>=none" over three
    // numerals a human can see on screen.
    await browse().browse("cafe");
    browse().setThreshold(27); // the map's budget pass, on `idle`
    await browse().browse("restaurant");

    expect(browse().category).toBe("restaurant");
    expect(browse().threshold).toBe(27);
  });

  it("leaves the ink budget to the map when browsing stops, too", async () => {
    // Same single-writer rule on the way out. Leaving browse always changes
    // the budget's answer to "nothing counted", so the map's next pass does
    // publish it — the store guessing first would only race it.
    await browse().browse("cafe");
    browse().setThreshold(27);
    browse().clear();

    expect(browse().category).toBeNull();
    expect(browse().threshold).toBe(27);
  });
});
