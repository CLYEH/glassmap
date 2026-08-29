import { expect, test } from "./fixtures";
import { expectBoundsShape, stableState, waitForFeatures } from "./helpers";

/**
 * End-to-end harness: drive the tools the way a WebMCP client would
 * (document.modelContext.getTools / executeTool) and check the page reflects it.
 * In a browser without native WebMCP the shim provides the same surface.
 */
test.describe("WebMCP tool surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__glassmap);
    // features_loaded is part of get_map_state's output and can transition
    // asynchronously (0 -> 2063) independently of any tool call -- same
    // flake class as `bounds` (see stableState below): settle it first so a
    // test reading get_map_state twice does not see it change mid-test.
    await waitForFeatures(page);
  });

  test("tools are registered on a modelContext surface", async ({ page }) => {
    const status = page.getByTestId("webmcp-status");
    // 12 = the 11 imperative registrations asserted below, plus the
    // declarative `<form toolname="add_note">`, which a WebMCP browser picks
    // up from the markup and which the badge counts out of the DOM.
    await expect(status).toContainText("12 tools");
    await expect(status).not.toContainText("none");

    const names = await page.evaluate(async () =>
      (await document.modelContext!.getTools()).map((t) => t.name).sort(),
    );
    expect(names).toEqual([
      "annotate",
      "compare_areas",
      "describe_surroundings",
      "draw_shape",
      "find_features",
      "get_map_state",
      "get_share_link",
      "list_features_in_view",
      "measure",
      "select_features",
      "set_map_view",
    ]);
  });

  test("set_map_view changes the page and get_map_state agrees with it", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const ctx = document.modelContext!;
      const tools = await ctx.getTools();
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      const set = JSON.parse(
        await ctx.executeTool(byName.set_map_view, { center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 }),
      );
      const get = JSON.parse(await ctx.executeTool(byName.get_map_state, {}));
      return { set, get };
    });

    expect(result.set).toMatchObject({ center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 });
    // Compare stable fields only, not the whole object: `bounds` is written
    // by MapCanvas's own effect independently of any tool call (constructor
    // time, then again once the container is measured, then again once
    // tiles load), so two reads a few milliseconds apart -- `set` catching
    // it still `null`, `get` catching the first real box -- can legitimately
    // disagree on it even though nothing asked the view to move. See
    // e2e/helpers.ts.
    expect(stableState(result.get)).toEqual(stableState(result.set));
    expectBoundsShape(result.set.bounds);
    expectBoundsShape(result.get.bounds);
    await expect(page.getByTestId("zoom")).toHaveText("15");
    await expect(page.getByTestId("center")).toHaveText("121.5436, 25.0264");
  });

  test("window.__glassmap.call is a shortcut for the same tools", async ({ page }) => {
    const out = await page.evaluate(async () => JSON.parse(await window.__glassmap!.call("get_map_state")));
    expect(out).toHaveProperty("center.lng");
    expect(out).toHaveProperty("zoom");
  });
});
