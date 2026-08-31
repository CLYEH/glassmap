/**
 * Multi-category browse (T-92) -- up to three kinds of place painted at once.
 *
 * `src/components/browse-store.test.ts` already covers the store contract in
 * isolation (order, eviction, per-category remove, the pending-membership
 * guard). This file is the part that unit test cannot see: the real chrome
 * (`PlacesDock`, `MarkerStatus`, `LoadedCategories`) wired to the same real
 * `fetch` tier2.spec.ts drives, so a person clicking three chips and the
 * off-screen `browse-state` mirror agree on the same story.
 *
 * Network-isolated like every other spec in this suite (fixtures.ts blocks
 * every non-localhost host): every tier-2 file lives under `/data/tier2/`,
 * same-origin to the `next dev` server, so no separate fixture files are
 * needed -- the real, shipped `public/data/tier2/*.geojson` extract is the
 * fixture, exactly as tier2.spec.ts uses it.
 *
 * The map never reaches MapLibre's `load` event under this isolation (the
 * basemap style is a cross-origin CDN URL), so the ink-budget pass
 * (`MapCanvas.tsx`'s `applyInkBudget`, armed on `map.on("idle", ...)` inside
 * the `load` handler) never runs and `useBrowseStore`'s `threshold` never
 * leaves its initial `Infinity`. Every `browse-state` string in this file is
 * therefore deterministically `counted>=none` -- this is the same
 * network-isolation guarantee tier2.spec.ts and tier2-live.spec.ts's own doc
 * comments already rely on, not a new assumption.
 */
import { BROWSE_MAX } from "@/components/browse-store";
import { browseTierMinimum } from "@/components/bead-style";
import { TIER2_PLURAL } from "@/components/category-labels";
import { DEFAULT_VIEW } from "@/lib/store/map-store";
import { callTool } from "./mcp";
import { waitForFeatures, waitForStoreHandle, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/** The zoom band this suite starts every page at, and never changes. */
const MIN = browseTierMinimum(DEFAULT_VIEW.zoom);

function chip(page: import("@playwright/test").Page, category: string) {
  return page.locator(`[data-testid="place-chip"][data-category="${category}"]`);
}

function activeItem(page: import("@playwright/test").Page, category: string) {
  return page.locator(`[data-testid="places-active-item"][data-category="${category}"]`);
}

function clearButton(page: import("@playwright/test").Page, category: string) {
  return page.locator(`[data-testid="places-clear"][data-category="${category}"]`);
}

function poiLoaded(page: import("@playwright/test").Page, category: string) {
  return page.locator(`[data-testid="poi-loaded-item"][data-category="${category}"]`);
}

test.describe("multi-category browse: order (T-92)", () => {
  test("three categories browsed in sequence keep tap order in browse-state, places-active and every chip", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    // Independent per-category totals, read the same way an agent's
    // `find_features` would answer -- not the manifest's citywide count, so
    // the union bound below is checked against a number this test derived the
    // same way the product does, not a second copy of the same arithmetic.
    const cafeTotal = (await callTool(page, "find_features", { categories: ["cafe"], limit: 1 }))
      .total!;
    const barTotal = (await callTool(page, "find_features", { categories: ["bar"], limit: 1 }))
      .total!;
    const bakeryTotal = (
      await callTool(page, "find_features", { categories: ["bakery"], limit: 1 })
    ).total!;

    await page.getByTestId("places-toggle").click();

    // Via the handle, not chip clicks: this test is about the store's order
    // guarantee, not the tray's click handler (see the eviction test for
    // that half).
    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));
    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("bar"));
    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("bakery"));

    const text = await page.getByTestId("browse-state").textContent();
    // Insertion order, never sorted -- "bakery" < "bar" < "cafe"
    // alphabetically, so a sort regression would reorder this string even
    // though nothing about which categories are painted changed.
    const match = text?.match(/^cafe,bar,bakery places=(\d+) min=(\d+) counted>=none$/);
    expect(match, `unexpected browse-state: "${text}"`).not.toBeNull();
    const places = Number(match![1]);
    // The union of three real categories: at least as large as the biggest
    // one alone, never larger than the plain sum -- a place tagged both
    // bakery and cafe is one grain on the map, not two.
    expect(places).toBeGreaterThanOrEqual(Math.max(cafeTotal, barTotal, bakeryTotal));
    expect(places).toBeLessThanOrEqual(cafeTotal + barTotal + bakeryTotal);
    expect(Number(match![2])).toBe(MIN);

    await expect(page.getByTestId("places-active")).toHaveAttribute(
      "data-categories",
      "cafe,bar,bakery",
    );

    for (const category of ["cafe", "bar", "bakery"]) {
      await expect(chip(page, category)).toHaveAttribute("aria-pressed", "true");
    }
  });
});

test.describe("multi-category browse: eviction (T-92)", () => {
  test("a fourth pick evicts the oldest kind, the foot names it, and the evicted kind stays loaded", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await page.getByTestId("places-toggle").click();

    // Real chip clicks, sequential and settled: the foot line this test
    // checks is local UI state set inside `PlacesDock`'s own click handler,
    // not something a direct store call would ever populate.
    const pick = async (category: string) => {
      await chip(page, category).click();
      await expect(chip(page, category)).not.toHaveAttribute("data-loading", "true");
    };

    await pick("cafe");
    await pick("bar");
    await pick("bakery");
    await expect(page.getByTestId("places-active")).toHaveAttribute(
      "data-categories",
      "cafe,bar,bakery",
    );

    await pick("museum");

    // The set is the newest three -- cafe (the oldest) is gone, not appended
    // past the cap and not the wrong one evicted.
    await expect(page.getByTestId("places-active")).toHaveAttribute(
      "data-categories",
      "bar,bakery,museum",
    );
    await expect(page.getByTestId("browse-state")).toHaveText(
      new RegExp(`^bar,bakery,museum places=\\d+ min=${MIN} counted>=none$`),
    );

    // A fourth tap that silently dropped the oldest pick would look like the
    // tap did nothing -- the foot has to say which one went.
    await expect(page.getByTestId("places-foot")).toHaveText(
      `${TIER2_PLURAL.cafe} came off the map — ${BROWSE_MAX} kinds of place at a time.`,
    );

    // Eviction unpaints, it does not unload: cafe's data is still in memory,
    // so it must reappear in the "loaded but not painted" disclosure the
    // instant it stops being one of the painted three.
    await expect(poiLoaded(page, "cafe")).toBeVisible();
    await expect(page.getByTestId("poi-loaded-item")).toHaveCount(1);

    // The evicted chip is unpressed -- it left the painted set, not just the
    // label on the foot line.
    await expect(chip(page, "cafe")).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("multi-category browse: per-category clear (T-92)", () => {
  test("clearing one category leaves the others painted and browse-state shrinks around the gap", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));
    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("bar"));
    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("bakery"));
    await expect(page.getByTestId("places-active")).toHaveAttribute(
      "data-categories",
      "cafe,bar,bakery",
    );

    await clearButton(page, "bar").click();

    // The gap closes without reshuffling the survivors relative to each
    // other: cafe stays before bakery, exactly as they were asked for.
    await expect(page.getByTestId("places-active")).toHaveAttribute(
      "data-categories",
      "cafe,bakery",
    );
    await expect(activeItem(page, "bar")).toHaveCount(0);
    await expect(page.getByTestId("browse-state")).toHaveText(
      new RegExp(`^cafe,bakery places=\\d+ min=${MIN} counted>=none$`),
    );

    // Cleared, not unloaded -- bar is still queryable, so it shows up in the
    // "loaded but not painted" disclosure exactly like an evicted category
    // would.
    await expect(poiLoaded(page, "bar")).toBeVisible();

    // The failure/success of a neighbour's clear must cost only that
    // neighbour.
    await expect(activeItem(page, "cafe")).toBeVisible();
    await expect(activeItem(page, "bakery")).toBeVisible();
  });
});

test.describe("multi-category browse: load-failure honesty (T-92)", () => {
  test("a category whose file never arrives paints nothing and leaves the rest of the set exactly as it was", async ({
    page,
  }) => {
    let abortedRequests = 0;
    await page.route("**/data/tier2/bar.geojson", (route) => {
      abortedRequests++;
      return route.abort();
    });

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));
    await expect(page.getByTestId("browse-state")).toHaveText(
      new RegExp(`^cafe places=\\d+ min=${MIN} counted>=none$`),
    );

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("bar"));

    // "No bars here" and "the bar file never arrived" must never look the
    // same: a failed load paints nothing, so browse-state is byte-identical
    // to the moment before bar was ever asked for.
    await expect(page.getByTestId("browse-state")).toHaveText(
      new RegExp(`^cafe places=\\d+ min=${MIN} counted>=none$`),
    );

    const { categories, pending } = await page.evaluate(() => {
      const s = window.__glassmapBrowse!.getState();
      return { categories: s.categories, pending: s.pending };
    });
    expect(categories).toEqual(["cafe"]);
    expect(pending).toEqual([]);
    // Proves the failure path actually ran rather than the assertion above
    // passing vacuously because bar was excluded for some unrelated reason.
    expect(abortedRequests).toBeGreaterThan(0);
  });
});

test.describe("multi-category browse: mid-fetch take-back (T-92)", () => {
  test("a category removed before its file lands never paints once the file finally arrives", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/data/tier2/museum.geojson", async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    // Fire-and-forget: the point of this test is what happens while the
    // fetch is still in flight, so the call must not be awaited here.
    await page.evaluate(() => {
      void window.__glassmapBrowse!.getState().browse("museum");
    });
    await expect(page.getByTestId("browse-state")).toHaveText("loading");

    await page.evaluate(() => window.__glassmapBrowse!.getState().remove("museum"));
    await expect(page.getByTestId("browse-state")).toHaveText("off");

    // Only now does the file arrive -- well after the human already said no.
    release();
    // This was the latent bug the pending-membership guard in `browse()`
    // fixes: without it, the map goes calm and then, a beat later, paints
    // the very category the person just dismissed. A fixed settle window is
    // the only way to prove that beat never comes, since a poll for "off"
    // would already be satisfied by the very state this is trying to catch a
    // regression away from.
    await page.waitForTimeout(300);

    await expect(page.getByTestId("browse-state")).toHaveText("off");
    const { categories, pending } = await page.evaluate(() => {
      const s = window.__glassmapBrowse!.getState();
      return { categories: s.categories, pending: s.pending };
    });
    expect(categories).toEqual([]);
    expect(pending).toEqual([]);
  });
});

test.describe("multi-category browse: single-category compatibility (T-92)", () => {
  test("browsing exactly one category matches the pre-multi-browse format byte for byte", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));

    const text = await page.getByTestId("browse-state").textContent();
    // The exact regex tier2-live.spec.ts asserts against a real, live-CDN
    // camera move. If a comma-join regression ever changed the
    // single-category shape, that spec would start failing for a reason
    // that has nothing to do with what it actually tests -- pinning it here,
    // under isolation, catches the regression closer to its cause.
    expect(text).toMatch(/^cafe places=\d+/);
    expect(text).toMatch(new RegExp(`^cafe places=\\d+ min=${MIN} counted>=none$`));
  });
});
