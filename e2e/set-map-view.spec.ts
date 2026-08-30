import { callTool } from "./mcp";
import { stableState, waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";
import type { ToolResult } from "./types";

test.describe("set_map_view", () => {
  test("two calls back-to-back: the second call's own state wins, not a mid-flight camera", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    // The race this test exercises (MapCanvas's toMap guard against a
    // synchronous, re-entrant moveend) only exists once a real MapLibre map
    // has been constructed. MapCanvas is a next/dynamic import, so
    // window.__glassmap existing does not mean it has mounted yet -- without
    // this wait the two set_map_view calls below just write straight to the
    // zustand store with nothing commanding a real camera at all, and the
    // test passes whether or not the guard exists.
    await waitForLiveMap(page);

    // Both calls are issued without awaiting the first -- the re-entrancy
    // the map-ui-dev -> qa handoff asked for. This suite is network-isolated
    // by default (fixtures.ts blocks the basemap CDN), so the style JSON
    // never arrives, styleLoaded never flips true, and applyView always
    // calls map.jumpTo, never map.flyTo (MapCanvas.tsx) -- jumpTo fires its
    // own moveend SYNCHRONOUSLY, inside the toMap guard, which is the
    // re-entrant event under test here. flyTo's own stop()-induced
    // re-entrant moveend (the race this guard was first written for) only
    // fires once the style has actually loaded, which needs a reachable
    // basemap: it is exercised only by the E2E_LIVE_BASEMAP=1 variant. Either
    // way, without the toMap guard the first call's own synchronous moveend
    // could clobber the state the second, still-in-flight call is about to
    // read back.
    const { first, second, get, mapExists } = await page.evaluate<{
      first: ToolResult;
      second: ToolResult;
      get: ToolResult;
      mapExists: boolean;
    }>(async () => {
      const ctx = document.modelContext!;
      const tools = await ctx.getTools();
      const setMapView = tools.find((t) => t.name === "set_map_view")!;
      const getMapState = tools.find((t) => t.name === "get_map_state")!;
      const p1 = ctx.executeTool(setMapView, { center: { lng: 121.5, lat: 25.1 }, zoom: 16 });
      const p2 = ctx.executeTool(setMapView, { center: { lng: 121.6, lat: 24.95 }, zoom: 11 });
      const [r1, r2] = await Promise.all([p1, p2]);
      const g = await ctx.executeTool(getMapState, {});
      return {
        first: JSON.parse(r1),
        second: JSON.parse(r2),
        get: JSON.parse(g),
        mapExists: !!window.__glassmapMap,
      };
    });

    // Proves the assertions below actually exercised the guard, not just
    // two writes to a plain in-memory store.
    expect(mapExists).toBe(true);

    expect(first.zoom).toBe(16);
    expect(second.zoom).toBe(11);
    expect(second.center).toEqual({ lng: 121.6, lat: 24.95 });
    expect(get.zoom).toBe(11);
    expect(get.center).toEqual({ lng: 121.6, lat: 24.95 });

    await expect(page.getByTestId("zoom")).toHaveText("11");
    await expect(page.getByTestId("center")).toHaveText("121.6, 24.95");
  });

  test("place resolves to the same centre as the equivalent feature_id lookup", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // Ground truth: the park's own id, resolved directly. "Daan Forest Park"
    // only matches the park's English name; the MRT station sharing the
    // Chinese name is called "Daan Park" in English, so this is NOT the
    // ambiguous case (see the next test) -- but the park and the station are
    // only tens to a few hundred metres apart, close enough that a loose
    // coordinate tolerance would not tell "resolved to the right feature"
    // apart from "resolved to the wrong, nearby one". Comparing centres with
    // toEqual instead of a tolerance closes that gap: both paths compute the
    // centre the same way (src/lib/map-tools/output.ts featureCenter,
    // rounded the same way), so they must match exactly, not approximately.
    const ground = await callTool(page, "set_map_view", { feature_id: "osm:way:1227733215" });
    expect(ground.error).toBeUndefined();

    const result = await callTool(page, "set_map_view", { place: "Daan Forest Park" });
    expect(result.error).toBeUndefined();
    expect(result.center).toEqual(ground.center);
    expect(result.zoom).toBe(15); // PLACE_ZOOM: no zoom was given.

    await expect(page.getByTestId("zoom")).toHaveText("15");
  });

  test("an ambiguous place is reported with candidates and does not move the map", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "get_map_state");
    const centerBefore = await page.getByTestId("center").textContent();

    // The park and the MRT station serving it share the exact same Chinese
    // name (the literal below), so the gazetteer cannot pick a winner and
    // must ask instead of guessing.
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
  });

  test("rejects an out-of-range zoom and leaves the camera untouched", async ({ page }) => {
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
    // Compare stable fields only: bounds is written by MapCanvas's own
    // effect independently of this call and can legitimately differ between
    // the two get_map_state reads (see e2e/helpers.ts stableState).
    expect(stableState(after)).toEqual(stableState(before));
    await expect(page.getByTestId("zoom")).toHaveText(zoomBefore!);
  });
});
