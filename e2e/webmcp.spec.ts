import { expect, test } from "@playwright/test";

/**
 * End-to-end harness: drive the tools the way a WebMCP client would
 * (document.modelContext.getTools / executeTool) and check the page reflects it.
 * In a browser without native WebMCP the shim provides the same surface.
 */
test.describe("WebMCP tool surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__glassmap);
  });

  test("tools are registered on a modelContext surface", async ({ page }) => {
    const status = page.getByTestId("webmcp-status");
    await expect(status).toContainText("2 tools");
    await expect(status).not.toContainText("none");

    const names = await page.evaluate(async () =>
      (await document.modelContext!.getTools()).map((t) => t.name).sort(),
    );
    expect(names).toEqual(["get_map_state", "set_map_view"]);
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
    expect(result.get).toEqual(result.set);
    await expect(page.getByTestId("zoom")).toHaveText("15");
    await expect(page.getByTestId("center")).toHaveText("121.5436, 25.0264");
  });

  test("window.__glassmap.call is a shortcut for the same tools", async ({ page }) => {
    const out = await page.evaluate(async () => JSON.parse(await window.__glassmap!.call("get_map_state")));
    expect(out).toHaveProperty("center.lng");
    expect(out).toHaveProperty("zoom");
  });
});
