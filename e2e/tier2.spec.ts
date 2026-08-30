/**
 * Tier-2 point-of-interest categories (T-62) -- end to end.
 *
 * `src/lib/store/tier2.ts` and `src/lib/map-tools/tier2-query.ts` already have
 * unit coverage for the registry (fetch-once, the manifest latch, merge order)
 * and for the disclosure/plan logic in isolation. This file is the part those
 * tests cannot see: a real `fetch` to a same-origin static file, counted at the
 * network layer, driven through `document.modelContext` the way a real WebMCP
 * client would, with the DOM (`feature-count`, `selection-count`) checked
 * against the tool's own JSON.
 *
 * This suite runs under the default network isolation (fixtures.ts blocks
 * every non-localhost host), and that is deliberate rather than a limitation:
 * every tier-2 file lives under `/data/tier2/`, same-origin to the `next dev`
 * server this suite drives, so category-lazy loading is fully exercised
 * without the basemap CDN ever being reachable.
 */
import type { Page } from "@playwright/test";
import { callTool } from "./mcp";
import { FEATURE_COUNT, waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";
import { blockExternalNetwork, expect, test } from "./fixtures";
import { MAX_LIMIT } from "@/lib/map-tools/query";
import { SELECT_MATCH_LIMIT } from "@/lib/map-tools/tier2-query";
import { TIER2_CATEGORIES } from "@/lib/store/tier2";

/** Taipei Main Station -- the same point `DEFAULT_VIEW` centres on. */
const CENTER = { lng: 121.5175, lat: 25.0478 };

/** The six bundled datasets, in the exact order `FEATURE_CATEGORIES` declares them. */
const BUNDLED_CATEGORIES = ["mrt_station", "park", "school", "supermarket", "listing", "district"];

/** Every request this test cares about, whichever category or the index it hit. */
function tier2Requests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/data/tier2/")) urls.push(url);
  });
  return urls;
}

test.describe("tier-2 category-lazy loading (T-62)", () => {
  test("naming a category fetches the manifest and the file once; a repeat call makes no new request", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const requests = tier2Requests(page);

    const first = await callTool(page, "find_features", {
      categories: ["cafe"],
      near: CENTER,
      radius_m: 500,
    });
    expect(first.error).toBeUndefined();
    // A real, non-trivial hit set -- not "the file loaded but matched nothing".
    expect(first.total!).toBeGreaterThan(0);

    expect(requests.filter((u) => u.endsWith("/data/tier2/index.json"))).toHaveLength(1);
    expect(requests.filter((u) => u.endsWith("/data/tier2/cafe.geojson"))).toHaveLength(1);
    expect(requests).toHaveLength(2);

    const state = await callTool(page, "get_map_state");
    expect(state.tier2?.loaded).toEqual(["cafe"]);
    // The machine mirror (StateOverlay.tsx) and the tool's own count must agree
    // the moment a POI category enters memory -- see its own doc comment.
    await expect(page.getByTestId("feature-count")).toHaveText(String(state.features_loaded));

    const second = await callTool(page, "find_features", {
      categories: ["cafe"],
      near: CENTER,
      radius_m: 500,
    });
    expect(second.error).toBeUndefined();
    expect(second.total).toBe(first.total);
    // Idempotent: the category was already in memory, so no fetch happened.
    expect(requests).toHaveLength(2);
  });
});

test.describe("tier-2 disclosure (T-62)", () => {
  test("a bare query names what it searched and what city-wide categories it left out", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const found = await callTool(page, "find_features", {});
    expect(found.error).toBeUndefined();
    // No category filter at all: every bundled feature, nothing tier-2 (none
    // loaded yet on a fresh page).
    expect(found.total).toBe(FEATURE_COUNT);
    expect(found.searched_categories).toEqual(BUNDLED_CATEGORIES);
    // The whole fixed vocabulary, alphabetical (toUnsearched's own sort),
    // because nothing has loaded a single one of them yet.
    expect(found.unsearched_categories?.map((c) => c.category)).toEqual(
      [...TIER2_CATEGORIES].sort(),
    );
    expect(found.unsearched_categories).toHaveLength(TIER2_CATEGORIES.length);
    // The count is real (read from the manifest, no fetch of the category
    // itself) -- not a placeholder zero.
    const cafeEntry = found.unsearched_categories!.find((c) => c.category === "cafe");
    expect(cafeEntry?.citywide_count).toBeGreaterThan(0);

    // Naming cafe removes exactly it from the unsearched list on the next bare
    // query -- disclosure tracks memory, not the previous call's filter.
    const loadCafe = await callTool(page, "find_features", { categories: ["cafe"], limit: 1 });
    expect(loadCafe.error).toBeUndefined();
    const again = await callTool(page, "find_features", {});
    expect(again.searched_categories).toEqual([...BUNDLED_CATEGORIES, "cafe"]);
    expect(again.unsearched_categories?.some((c) => c.category === "cafe")).toBe(false);
    expect(again.unsearched_categories).toHaveLength(TIER2_CATEGORIES.length - 1);
  });

  test("list_features_in_view with no categories names what is on screen and what is still city-wide", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
    );

    const result = await callTool(page, "list_features_in_view", {});
    expect(result.error).toBeUndefined();
    expect(result.category_counts).toBeDefined();
    // Nothing tier-2 loaded yet: every counted category is one of the six
    // bundled ones, and there is at least one feature on screen to count.
    const counted = Object.keys(result.category_counts!);
    expect(counted.length).toBeGreaterThan(0);
    for (const category of counted) expect(BUNDLED_CATEGORIES).toContain(category);
    const total = Object.values(result.category_counts!).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(result.unsearched_categories).toHaveLength(TIER2_CATEGORIES.length);
  });

  test("a deployment with no tier-2 index discloses nothing, answers only the bundled data, and asks once", async ({
    page,
  }) => {
    let indexRequests = 0;
    await page.route("**/data/tier2/index.json", (route) => {
      indexRequests++;
      return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
    });

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const first = await callTool(page, "find_features", {});
    expect(first.error).toBeUndefined();
    expect(first.total).toBe(FEATURE_COUNT);
    expect(first.searched_categories).toBeUndefined();
    expect(first.unsearched_categories).toBeUndefined();

    // A second bare query must not re-ask an index this build already knows
    // is missing (the `manifestAbsent` latch, `store/tier2.ts`) -- a 404 is a
    // fact about the deployment, not a moment to retry.
    const second = await callTool(page, "find_features", {});
    expect(second.searched_categories).toBeUndefined();
    expect(second.unsearched_categories).toBeUndefined();

    await expect(page.getByTestId("feature-count")).toHaveText(String(FEATURE_COUNT));
    expect(indexRequests).toBe(1);
  });
});

test.describe("select_features point-of-interest cap (T-62)", () => {
  test("a citywide category over the cap is refused with the true count; a narrowed filter succeeds", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "get_map_state");

    // Citywide restaurants comfortably exceed SELECT_MATCH_LIMIT (13k+ in the
    // shipped extract) -- read the true count from find_features rather than
    // hard-coding it, so this test keeps meaning what it says if the extract
    // is ever regenerated.
    const citywide = await callTool(page, "find_features", { categories: ["restaurant"], limit: 1 });
    expect(citywide.error).toBeUndefined();
    expect(citywide.total!).toBeGreaterThan(SELECT_MATCH_LIMIT);

    const refused = await callTool(page, "select_features", { categories: ["restaurant"] });
    expect(typeof refused.error).toBe("string");
    expect(refused.matched).toBe(citywide.total);
    // Refused, not partially applied: the selection is exactly what it was.
    expect(refused.state!.selection.count).toBe(before.selection!.count);
    await expect(page.getByTestId("selection-count")).toHaveText(String(before.selection!.count));

    // Narrowing with near + radius_m brings the same category under the cap.
    const narrowed = await callTool(page, "find_features", {
      categories: ["restaurant"],
      near: CENTER,
      radius_m: 500,
      limit: 1,
    });
    expect(narrowed.error).toBeUndefined();
    expect(narrowed.total!).toBeGreaterThan(0);
    expect(narrowed.total!).toBeLessThanOrEqual(SELECT_MATCH_LIMIT);

    const accepted = await callTool(page, "select_features", {
      categories: ["restaurant"],
      near: CENTER,
      radius_m: 500,
    });
    expect(accepted.error).toBeUndefined();
    expect(accepted.state!.selection.count).toBe(narrowed.total);
    await expect(page.getByTestId("selection-count")).toHaveText(String(narrowed.total));
  });
});

test.describe("tier-2 determinism (T-62)", () => {
  test("loading bar then cafe vs cafe then bar answers an identical mixed-category query", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await blockExternalNetwork(pageA);
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await blockExternalNetwork(pageB);

    await pageA.goto("/");
    await waitForTools(pageA);
    await waitForFeatures(pageA);
    await pageB.goto("/");
    await waitForTools(pageB);
    await waitForFeatures(pageB);

    // Opposite load order on each page: bar-then-cafe on A, cafe-then-bar on B.
    const barA = await callTool(pageA, "find_features", { categories: ["bar"], limit: 1 });
    expect(barA.error).toBeUndefined();
    const cafeA = await callTool(pageA, "find_features", { categories: ["cafe"], limit: 1 });
    expect(cafeA.error).toBeUndefined();

    const cafeB = await callTool(pageB, "find_features", { categories: ["cafe"], limit: 1 });
    expect(cafeB.error).toBeUndefined();
    const barB = await callTool(pageB, "find_features", { categories: ["bar"], limit: 1 });
    expect(barB.error).toBeUndefined();

    const mixedFilter = {
      categories: ["bar", "cafe"],
      near: CENTER,
      radius_m: 500,
      limit: MAX_LIMIT,
    };
    const outA = await callTool(pageA, "find_features", mixedFilter);
    const outB = await callTool(pageB, "find_features", mixedFilter);

    expect(outA.error).toBeUndefined();
    expect(outB.error).toBeUndefined();
    // Under MAX_LIMIT at this radius (measured against the shipped extract),
    // so `returned === total` on both sides and this compares the whole set,
    // not just a shared prefix.
    expect(outA.total!).toBeLessThan(MAX_LIMIT);
    expect(outA.total).toBe(outA.returned);
    expect(outA.total).toBe(outB.total);
    expect(outA.features).toEqual(outB.features);

    await contextA.close();
    await contextB.close();
  });
});
