import { callTool } from "./mcp";
import { stableState, waitForFeatures, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";
import type { ToolResult } from "./types";

test.describe("set_map_view", () => {
  test("two calls back-to-back: the second call's own state wins, not a mid-flight camera", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);

    // Both calls are issued without awaiting the first -- the re-entrancy
    // the map-ui-dev -> qa handoff asked for. Before the guard in
    // MapCanvas.tsx (`toMap`), the second flyTo's synchronous `stop()` could
    // fire a `moveend` for the FIRST, still mid-flight, camera and clobber
    // the state the second call is about to read back.
    const { first, second, get } = await page.evaluate<{
      first: ToolResult;
      second: ToolResult;
      get: ToolResult;
    }>(async () => {
      const ctx = document.modelContext!;
      const tools = await ctx.getTools();
      const setMapView = tools.find((t) => t.name === "set_map_view")!;
      const getMapState = tools.find((t) => t.name === "get_map_state")!;
      const p1 = ctx.executeTool(setMapView, { center: { lng: 121.5, lat: 25.1 }, zoom: 16 });
      const p2 = ctx.executeTool(setMapView, { center: { lng: 121.6, lat: 24.95 }, zoom: 11 });
      const [r1, r2] = await Promise.all([p1, p2]);
      const g = await ctx.executeTool(getMapState, {});
      return { first: JSON.parse(r1), second: JSON.parse(r2), get: JSON.parse(g) };
    });

    expect(first.zoom).toBe(16);
    expect(second.zoom).toBe(11);
    expect(second.center).toEqual({ lng: 121.6, lat: 24.95 });
    expect(get.zoom).toBe(11);
    expect(get.center).toEqual({ lng: 121.6, lat: 24.95 });

    await expect(page.getByTestId("zoom")).toHaveText("11");
    await expect(page.getByTestId("center")).toHaveText("121.6, 24.95");

    expect(pageErrors).toEqual([]);
  });

  test("place resolves to the matching feature's centre when the name is unambiguous", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    // The gazetteer is built from loaded features (src/lib/map-tools/gazetteer.ts):
    // without this, a place lookup issued right after window.__glassmap
    // appears can race useFeatureData's fetch and see zero features.
    await waitForFeatures(page);

    // "Daan Forest Park" only matches the park's English name; the MRT
    // station sharing the Chinese name is called "Daan Park" in English, so
    // this is NOT the ambiguous case (see the next test).
    const result = await callTool(page, "set_map_view", { place: "Daan Forest Park" });
    expect(result.error).toBeUndefined();
    expect(result.center).toBeDefined();
    expect(Math.abs(result.center!.lng - 121.536)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.center!.lat - 25.03)).toBeLessThanOrEqual(0.01);
    expect(result.zoom).toBe(15); // PLACE_ZOOM: no zoom was given.

    await expect(page.getByTestId("zoom")).toHaveText("15");

    expect(pageErrors).toEqual([]);
  });

  test("an ambiguous place is reported with candidates and does not move the map", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "get_map_state");
    const centerBefore = await page.getByTestId("center").textContent();

    // 大安森林公園 is the exact name of both the MRT station and the park
    // itself, so the gazetteer cannot pick a winner and must ask instead of
    // guessing.
    const result = await callTool(page, "set_map_view", { place: "大安森林公園" });
    expect(typeof result.error).toBe("string");
    expect(result.candidates).toBeDefined();
    expect(result.candidates!.length).toBeGreaterThanOrEqual(2);
    for (const candidate of result.candidates!) {
      expect(typeof candidate.id).toBe("string");
      expect(typeof candidate.name).toBe("string");
      expect(typeof candidate.distance_m).toBe("number");
    }

    const after = await callTool(page, "get_map_state");
    expect(after.center).toEqual(before.center);
    expect(after.zoom).toEqual(before.zoom);
    await expect(page.getByTestId("center")).toHaveText(centerBefore!);

    expect(pageErrors).toEqual([]);
  });

  test("rejects an out-of-range zoom and leaves the camera untouched", async ({ page, pageErrors }) => {
    await page.goto("/");
    await waitForTools(page);
    // Let features_loaded settle before the "before" snapshot, so its own
    // async load cannot be mistaken for a change caused by this call.
    await waitForFeatures(page);

    const before = await callTool(page, "get_map_state");
    const zoomBefore = await page.getByTestId("zoom").textContent();

    const result = await callTool(page, "set_map_view", { zoom: 99 });
    expect(typeof result.error).toBe("string");

    const after = await callTool(page, "get_map_state");
    // Compare stable fields only: `bounds` is written by MapCanvas's own
    // effect independently of this call and can legitimately differ between
    // the two get_map_state reads (see e2e/helpers.ts stableState).
    expect(stableState(after)).toEqual(stableState(before));
    await expect(page.getByTestId("zoom")).toHaveText(zoomBefore!);

    expect(pageErrors).toEqual([]);
  });
});
