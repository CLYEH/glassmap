import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category, Tier2RestoreResult } from "@/lib/store/tier2";
import { BROWSE_MAX, useBrowseStore } from "./browse-store";

const browse = () => useBrowseStore.getState();

const realRestore = useMapStore.getState().restoreTier2Categories;

/** The loader, stubbed: what browsing does with the answer is what is on test. */
const restoreReturns = (ok: boolean) =>
  useMapStore.setState({
    restoreTier2Categories: async (categories: readonly Tier2Category[]) =>
      ({ ok, loaded: ok ? [...categories] : [], failed: [] }) satisfies Tier2RestoreResult,
  });

/** A loader that answers only when the test says so — for the in-flight cases. */
const restoreOnCommand = () => {
  let release = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  useMapStore.setState({
    restoreTier2Categories: async (categories: readonly Tier2Category[]) => {
      await arrived;
      return { ok: true, loaded: [...categories], failed: [] } satisfies Tier2RestoreResult;
    },
  });
  return release;
};

describe("browse store", () => {
  beforeEach(() => {
    useBrowseStore.setState({
      categories: [],
      pending: [],
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
    expect(browse().categories).toEqual([]);
    expect(browse().pending).toEqual([]);
  });

  it("leaves the rest of the set alone when one category fails to load", async () => {
    // The failure must cost only itself. A person browsing cafes and bars who
    // taps a third kind whose file is missing still has cafes and bars on the
    // map, and the tray's "could not load" line is about that third kind only.
    await browse().browse("cafe");
    await browse().browse("bar");
    restoreReturns(false);
    await browse().browse("museum");
    expect(browse().categories).toEqual(["cafe", "bar"]);
  });

  it("paints up to three kinds at once, in the order they were asked for", async () => {
    // Order is not cosmetic: it is the eviction queue, and the strip in the
    // dock is drawn from it, so the leftmost chip is the one a fourth tap
    // would replace.
    await browse().browse("cafe");
    await browse().browse("bar");
    await browse().browse("bakery");
    expect(browse().categories).toEqual(["cafe", "bar", "bakery"]);
    expect(BROWSE_MAX).toBe(3);
  });

  it("evicts the oldest kind when a fourth is asked for", async () => {
    // The cap answers rather than refuses: a fourth tap is a person saying
    // "show me this", and a tray that simply ignored it would look broken.
    // What it costs is the oldest pick, which the tray then names out loud.
    for (const category of ["cafe", "bar", "bakery", "museum"] as const) {
      await browse().browse(category);
    }
    expect(browse().categories).toEqual(["bar", "bakery", "museum"]);
  });

  it("says which kind the cap pushed off, and nothing when it pushed none", async () => {
    // The tray's foot line is written from this answer, so it has to come from
    // the write that evicted. The alternative — compare the set before and
    // after the await — cannot tell the cap's doing from the human's.
    expect(await browse().browse("cafe")).toBeNull();
    expect(await browse().browse("bar")).toBeNull();
    expect(await browse().browse("bakery")).toBeNull();
    expect(await browse().browse("museum")).toBe("cafe");
    expect(await browse().browse("bank")).toBe("bar");
  });

  it("blames the cap for nothing when the human closed a kind mid-fetch", async () => {
    // Three painted, a fourth on its way, and the person takes one off with
    // its × while the file is arriving. The fourth then fits, so nothing was
    // evicted — and the tray must not say "came off the map, three at a time"
    // about a chip they closed themselves.
    for (const category of ["cafe", "bar", "bakery"] as const) await browse().browse(category);
    const release = restoreOnCommand();
    const inFlight = browse().browse("museum");
    browse().remove("bar");
    release();

    expect(await inFlight).toBeNull();
    expect(browse().categories).toEqual(["cafe", "bakery", "museum"]);
  });

  it("says nothing was evicted when the file never arrived", async () => {
    // A failed fourth costs the human nothing: the three they had stay, and
    // the tray has one thing to report, not two.
    for (const category of ["cafe", "bar", "bakery"] as const) await browse().browse(category);
    restoreReturns(false);
    expect(await browse().browse("museum")).toBeNull();
    expect(browse().categories).toEqual(["cafe", "bar", "bakery"]);
  });

  it("says nothing was evicted for a kind that is already painted", async () => {
    // The re-ask is a no-op, and a no-op has no casualty to report.
    await browse().browse("cafe");
    expect(await browse().browse("cafe")).toBeNull();
  });

  it("never paints a kind twice, and re-asking does not move it in the queue", async () => {
    // Otherwise the same grains would be pushed into the source under two
    // slots, and a place would be counted twice inside one cluster's numeral.
    await browse().browse("cafe");
    await browse().browse("bar");
    await browse().browse("cafe");
    expect(browse().categories).toEqual(["cafe", "bar"]);
  });

  it("takes one kind off the map and leaves the others painted", async () => {
    await browse().browse("cafe");
    await browse().browse("bar");
    browse().remove("cafe");
    expect(browse().categories).toEqual(["bar"]);
  });

  it("ignores a removal of a kind that was never browsed", async () => {
    await browse().browse("cafe");
    browse().remove("museum");
    expect(browse().categories).toEqual(["cafe"]);
  });

  it("empties the whole set on clear, so the calm map comes back", async () => {
    await browse().browse("cafe");
    await browse().browse("bar");
    browse().clear();
    expect(browse().categories).toEqual([]);
  });

  it("does not paint a kind the human took back while its file was in flight", async () => {
    // A tap and a clear are both answers, and the later one wins. Without
    // this the map would go calm and then, a second or two afterwards, paint
    // the very category the person had just dismissed.
    const release = restoreOnCommand();
    const inFlight = browse().browse("cafe");
    expect(browse().pending).toEqual(["cafe"]);
    browse().clear();
    release();
    await inFlight;
    expect(browse().categories).toEqual([]);
    expect(browse().pending).toEqual([]);
  });

  it("does not fetch the same kind twice while it is already on its way", async () => {
    // A second tap on a chip that is already loading is a person being
    // impatient, not a request for a second copy of the file.
    const release = restoreOnCommand();
    const first = browse().browse("cafe");
    const second = browse().browse("cafe");
    expect(browse().pending).toEqual(["cafe"]);
    release();
    await Promise.all([first, second]);
    expect(browse().categories).toEqual(["cafe"]);
  });

  it("leaves the ink budget to the map, across a change to the browsed set", async () => {
    // The regression this file exists for. The map republishes the threshold
    // only when it *changes* — setting the same filter repaints, which fires
    // `idle`, which re-enters the budget pass — so a store-side reset the map
    // cannot see survives: add a category whose budget lands on the same
    // number and the store says "none counted" while the layer filter is still
    // counting at 27, i.e. `browse-state` prints "counted>=none" over three
    // numerals a human can see on screen.
    await browse().browse("cafe");
    browse().setThreshold(27); // the map's budget pass, on `idle`
    await browse().browse("bar");

    expect(browse().categories).toEqual(["cafe", "bar"]);
    expect(browse().threshold).toBe(27);
  });

  it("leaves the ink budget to the map when a kind comes off, too", async () => {
    // Same single-writer rule on the way out, and it now has two doors:
    // removing one of three categories changes what is on screen without
    // emptying the map, and the budget still belongs to the map's own pass.
    await browse().browse("cafe");
    await browse().browse("bar");
    browse().setThreshold(27);
    browse().remove("bar");
    expect(browse().threshold).toBe(27);

    browse().clear();
    expect(browse().categories).toEqual([]);
    expect(browse().threshold).toBe(27);
  });
});
