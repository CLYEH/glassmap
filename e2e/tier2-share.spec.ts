/**
 * Tier-2 share links, wire v2 (T-63 / T-63b) -- end to end.
 *
 * `src/lib/map-tools/share.ts` and `src/components/share-hash.ts` already
 * cover the codec and `shareCategories`'s transient/permanent split in
 * isolation. This file is the part those tests cannot see: a link built by
 * `get_share_link` on one page, opened by a fresh browser context the way an
 * actual recipient would, with the tier-2 category file either arriving,
 * dropped mid-flight (`route.abort()` -- a moment, not a fact) or refused
 * outright (`404` -- a fact this deployment will not change its mind about).
 */
import type { Page } from "@playwright/test";
import { callTool } from "./mcp";
import { waitForFeatures, waitForTools } from "./helpers";
import { blockExternalNetwork, expect, test } from "./fixtures";
import { SHARE_VERSION_BASE, SHARE_VERSION_TIER2 } from "@/lib/map-tools/share";

/** Taipei Main Station -- the same point `DEFAULT_VIEW` centres on. */
const CENTER = { lng: 121.5175, lat: 25.0478 };

/** Load cafe, select its `n` nearest hits, and build a link for them. */
async function loadSelectAndShare(page: Page, n: number): Promise<{ ids: string[]; url: string }> {
  const cafes = await callTool(page, "find_features", { categories: ["cafe"], near: CENTER, limit: n });
  expect(cafes.error).toBeUndefined();
  expect(cafes.features).toHaveLength(n);
  const ids = cafes.features!.map((f) => f.id);

  const selected = await callTool(page, "select_features", { ids });
  expect(selected.error).toBeUndefined();
  expect(selected.state!.selection.count).toBe(n);

  const share = await callTool(page, "get_share_link");
  expect(share.error).toBeUndefined();
  expect(share.url).toBeDefined();
  return { ids, url: share.url! };
}

test.describe("tier-2 share round trip (T-63)", () => {
  test("a link carrying a loaded category is v2, converges the bar, and restores the selection", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const { ids, url } = await loadSelectAndShare(page, 5);
    const sentHash = `#${url.split("#")[1]}`;
    expect(sentHash.startsWith(`#${SHARE_VERSION_TIER2}.`)).toBe(true);

    // The sender's own address bar converges on byte-identically what
    // get_share_link just handed out (useShareHash's debounced mirror).
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(sentHash);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    // A fresh context is not covered by fixtures.ts's auto-block (T-13).
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await page2.goto(url);
    await waitForTools(page2);

    // Poll every signal to convergence rather than snapshotting once: the
    // camera and the selection ids restore synchronously inside the mount
    // effect, but the cafe file itself is still in flight (applyShareHash
    // starts, and deliberately does not await, restoreTier2Categories).
    await expect.poll(() => page2.evaluate(() => location.hash)).toBe(sentHash);
    await expect
      .poll(async () => (await callTool(page2, "get_map_state")).tier2?.loaded)
      .toEqual(["cafe"]);
    await expect(page2.getByTestId("selection-count")).toHaveText("5");

    // The payoff: the recipient's actual sidebar, not just the tool's JSON --
    // every selected id materialised into a named, categorised row.
    const rows = page2.locator('[data-testid="sidebar-selection"] li');
    await expect(rows).toHaveCount(5);
    for (const id of ids) {
      await expect(
        page2.locator(`[data-testid="sidebar-selection"] li[data-feature-id="${id}"]`),
      ).toHaveAttribute("data-category", "cafe");
    }

    await context2.close();
    expect(errors2).toEqual([]);
  });

  test("a transient failure to load the shared category keeps the link at v2 and shows the notice", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const { url } = await loadSelectAndShare(page, 3);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await blockExternalNetwork(page2);
    // A dropped connection, not a "no such file" -- isPermanentFetchError only
    // recognises a 4xx, so this is the transient half of the split.
    await page2.route("**/data/tier2/cafe.geojson", (route) => route.abort());

    await page2.goto(url);
    await waitForTools(page2);

    const failure = page2.getByTestId("share-restore-failure");
    await expect(failure).toHaveCount(1);
    await expect(failure).toContainText("couldn't load");
    await expect(failure).toContainText("cafe");
    await expect(failure).toHaveAttribute("data-category", "cafe");

    // A transient failure keeps its category declared (shareCategories):
    // the next page to open this link is meant to ask for the file again.
    await expect
      .poll(() => page2.evaluate(() => location.hash))
      .toMatch(new RegExp(`^#${SHARE_VERSION_TIER2}\\.`));

    const state = await callTool(page2, "get_map_state");
    expect(state.tier2?.failed).toEqual([
      expect.objectContaining({ category: "cafe" }),
    ]);
    // The selected ids are not lost, only unresolved: the link named both the
    // features and the file they live in, and the file never arrived.
    await expect(page2.getByTestId("selection-count")).toHaveText("3");

    await context2.close();
  });

  test("a permanent failure to load the shared category drops it and falls the link back to v1", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const { url } = await loadSelectAndShare(page, 3);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await blockExternalNetwork(page2);
    // A 4xx: isPermanentFetchError is true, so this deployment is never going
    // to have the file, however many times a later page asks for it.
    await page2.route("**/data/tier2/cafe.geojson", (route) =>
      route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }),
    );

    await page2.goto(url);
    await waitForTools(page2);

    await expect(page2.getByTestId("share-restore-failure")).toHaveCount(1);
    await expect(page2.getByTestId("share-restore-failure")).toHaveAttribute(
      "data-category",
      "cafe",
    );

    // No other tier-2 category is declared on this link, so dropping the
    // permanently-failed one empties `t` entirely -- content decides the
    // version (share.ts), and an empty `t` encodes as v1, byte for byte.
    await expect
      .poll(() => page2.evaluate(() => location.hash))
      .toMatch(new RegExp(`^#${SHARE_VERSION_BASE}\\.`));

    const state = await callTool(page2, "get_map_state");
    expect(state.tier2?.loaded).toEqual([]);
    expect(state.tier2?.failed).toEqual([
      expect.objectContaining({ category: "cafe" }),
    ]);

    await context2.close();
  });
});
