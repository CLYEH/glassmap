/**
 * T-54 -- the agent-activity feed (ActivityFeed.tsx) across the three tiers
 * that change its behaviour (globals.css): >=1241 full, floating, expanded;
 * 921-1240 the same floating panel but starting collapsed once busy (so the
 * map stays the scarce, readable thing); <=920 the floating panel does not
 * render at all (`if (sheet) return null`) and the sheet's Activity tab +
 * ticker carry the same store instead.
 *
 * One page, one store, three `setViewportSize` calls: the calls are driven
 * once through `document.modelContext` and the viewport is resized under it,
 * the same way an agent's calls would keep landing while a human resizes the
 * window -- not three separate page loads that would each need to redrive
 * the same five calls.
 */
import { callTool } from "./mcp";
import { waitForFeatures, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

const CENTER = { lng: 121.5175, lat: 25.0478 };

/** set_map_view, draw_shape, find_features, select_features, annotate -- 5 distinct calls, only one of which (find_features) is read-only, so none of them form a foldable run. */
async function driveFiveCalls(page: import("@playwright/test").Page): Promise<void> {
  const view = await callTool(page, "set_map_view", { center: CENTER, zoom: 14 });
  expect(view.error).toBeUndefined();

  const drawn = await callTool(page, "draw_shape", {
    type: "circle",
    center: CENTER,
    radius_m: 300,
    label: "walk radius",
  });
  expect(drawn.error).toBeUndefined();

  const found = await callTool(page, "find_features", {
    near: "Daan Park",
    radius_m: 800,
    categories: ["park", "school"],
  });
  expect(found.error).toBeUndefined();

  const selected = await callTool(page, "select_features", {
    near: "Daan Park",
    radius_m: 800,
    categories: ["park", "school"],
  });
  expect(selected.error).toBeUndefined();

  const annotated = await callTool(page, "annotate", { at: CENTER, note: "quiet corner" });
  expect(annotated.error).toBeUndefined();
}

test.describe("activity feed across breakpoints (T-54)", () => {
  test("full desktop shows every call expanded; mid tier starts the same feed collapsed; the sheet tier swaps to the tab + ticker", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1441, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    await driveFiveCalls(page);

    await expect(page.getByTestId("activity-feed")).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId("activity-call")).toHaveCount(5);
    await expect(page.getByTestId("activity-count")).toHaveText("5 calls");

    // Resize under the same store: the mid tier (921-1240) starts a busy
    // feed collapsed (globals.css), without losing a single row.
    await page.setViewportSize({ width: 960, height: 900 });
    await expect(page.getByTestId("activity-feed")).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("activity-call")).toHaveCount(5);
    await expect(page.getByTestId("activity-count")).toHaveText("5 calls");

    // The sheet tier (<=920) does not render the floating panel at all --
    // ActivityFeed.tsx returns null there on purpose, so a row is never two
    // elements sharing one data-testid.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByTestId("activity-feed")).toHaveCount(0);
    await expect(page.getByTestId("sheet-tab-activity")).toBeVisible();
    await expect(page.getByTestId("activity-ticker")).toBeVisible();
    // The 5 calls are not lost -- the Activity tab's own tab panel renders
    // them (Inspector.tsx's ActivityPanel), and the tab defaults open.
    await expect(page.getByTestId("sheet-tab-activity")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("activity-call")).toHaveCount(5);
  });

  test("a run of consecutive read calls folds into one row without hiding the true call count", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1441, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // 4 consecutive, successful, read-only calls: one more than
    // FOLD_READS_FROM (activity-model.ts), so the whole run collapses into a
    // single row -- but the feed's own counter must keep saying 4, not 1.
    for (let i = 0; i < 4; i++) {
      const result = await callTool(page, "get_map_state");
      expect(result.error).toBeUndefined();
    }

    await expect(page.getByTestId("activity-count")).toHaveText("4 calls");

    const rows = page.locator('[data-testid="activity-call"][data-tool="get_map_state"]');
    await expect(rows).toHaveCount(1);
    await expect(rows).toHaveAttribute("data-folded", "4");
  });

  test("a run of only 2 consecutive reads is under the fold threshold and stays as 2 separate rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1441, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    await callTool(page, "get_map_state");
    await callTool(page, "get_map_state");

    await expect(page.getByTestId("activity-count")).toHaveText("2 calls");
    const rows = page.locator('[data-testid="activity-call"][data-tool="get_map_state"]');
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      expect(await row.getAttribute("data-folded")).toBeNull();
    }
  });
});
