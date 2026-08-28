import { callTool } from "./mcp";
import {
  FEATURE_COUNT,
  blockBasemapNetwork,
  forceNoWebGL2,
  waitForFeatures,
  waitForLiveMap,
  waitForTools,
} from "./helpers";
import { expect, test } from "./fixtures";

/**
 * T-13 items 1 + 3: feature data must be readable through the tools -- and
 * agree with the DOM -- independent of whether MapLibre itself ever finishes
 * rendering (useFeatureData's fetch does not depend on the map at all). The
 * visible bounds is a narrower guarantee than the task brief first assumed:
 * it is written by MapCanvas's own effect, so it necessarily needs a real
 * MapLibre map object to exist. The first three tests below therefore need
 * WebGL2 to actually work (verified against this worktree's real browser,
 * not forced) and prove bounds does not additionally need the basemap style
 * or tiles to load. The last test forces the one case that is NOT covered by
 * that -- WebGL2 itself unavailable, i.e. real headless CI without a GPU --
 * and documents that bounds does not currently survive it.
 */
test.describe("data + view state", () => {
  test("2063 features load; get_map_state agrees with the DOM, bounds included", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    // Give the map effect (a dynamic import, so not guaranteed to have run
    // yet just because window.__glassmap exists) every chance to have set
    // bounds before we read it.
    await waitForLiveMap(page);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
    );

    const state = await callTool(page, "get_map_state");
    expect(state.features_loaded).toBe(FEATURE_COUNT);
    expect(state.bounds).not.toBeNull();
    expect(state.bounds).toMatchObject({
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
    });

    await expect(page.getByTestId("bounds")).not.toHaveText("none");
  });

  test("bounds becomes available without waiting for map-status to reach ready", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);

    // Do NOT assert this holds the instant window.__glassmap exists: that is
    // not actually guaranteed (see the "back-to-back reads can disagree on
    // bounds" fix in webmcp.spec.ts -- MapCanvas is a dynamic import, so its
    // effect, and the constructor-time setBounds() inside it, can still be
    // pending at that point). What IS guaranteed, and worth testing, is that
    // bounds does not wait for the "load" event / tile fetch: poll for it
    // deterministically instead of asserting a single racy snapshot.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
    );
    const statusWhenBoundsAppeared = await page.getByTestId("map-status").textContent();
    // "ready" only fires after tiles load; seeing bounds while still
    // "loading" (or having missed that window because this run was fast) are
    // both fine, but "unavailable" would mean bounds appeared without a map
    // at all, which should not happen on this code path (WebGL is real here,
    // not forced unavailable).
    expect(statusWhenBoundsAppeared).not.toBe("unavailable");

    const state = await callTool(page, "get_map_state");
    expect(state.bounds).not.toBeNull();
  });

  test("bounds becomes available even when the basemap style/tiles never load", async ({ page }) => {
    // Stronger version of the previous test: instead of racing a fast-enough
    // poll against a basemap that happens to load quickly, make the
    // "never reaches ready" window permanent by blocking the network the
    // basemap needs. map-status can then only become "loading" or "error"
    // (MapCanvas.tsx's map.on("error", ...) sets "error" when a tile/style
    // request fails before `ready`), never "ready" -- so if bounds is
    // non-null here, it genuinely does not depend on the basemap loading.
    await blockBasemapNetwork(page);
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
    );

    const status = await page.getByTestId("map-status").textContent();
    expect(status).not.toBe("ready");
    expect(status).not.toBe("unavailable"); // WebGL itself is real here.

    const state = await callTool(page, "get_map_state");
    expect(state.bounds).not.toBeNull();
  });

  test("data still loads without WebGL2, and map-status reports unavailable", async ({ page }) => {
    await forceNoWebGL2(page);
    await page.goto("/");
    await waitForTools(page);
    await expect(page.getByTestId("map-status")).toHaveText("unavailable");

    // Data loading does not depend on WebGL: this part of MapCanvas.tsx's
    // "no map, but ... every tool keep[s] working" comment does hold.
    await waitForFeatures(page);
    const state = await callTool(page, "get_map_state");
    expect(state.features_loaded).toBe(FEATURE_COUNT);
  });

  test("KNOWN DEFECT: bounds never becomes available once WebGL2 is unavailable", async ({ page }) => {
    // Kept minimal on purpose (just goto + wait for tools + the one
    // assertion): test.fail() marks the WHOLE test body as "expected to
    // fail", so a regression anywhere else in a larger test (e.g. tool
    // registration breaking, or forceNoWebGL2 silently stopping working)
    // would be swallowed as "expected" too. The previous test above already
    // covers "map-status is unavailable" and "features still load" as
    // ordinary, must-pass assertions; this test isolates only the genuinely
    // broken part.
    //
    // MapCanvas.tsx:
    //   if (!hasWebGL2()) {
    //     setStatus("unavailable");
    //     return;               // <-- never reaches pushViewFromMap()
    //   }
    // `pushViewFromMap()` is the ONLY place that calls
    // `store.getState().setBounds(...)`. Bounds starts `null` in the store
    // and this early return means nothing ever sets it, so it stays `null`
    // forever on this path.
    //
    // Expected (per docs/TASKS.md's map-ui-dev -> qa handoff, "get_map_state
    // ().bounds is non-null immediately after window.__glassmap appears",
    // and this task's items 1/3, "non-null bounds ... in BOTH ready and
    // unavailable states"): bounds is non-null here too.
    // Actual: bounds is `null` and never changes.
    //
    // This also falsifies the comment on that early return itself ("no map,
    // but ... every tool keep[s] working"): list_features_in_view requires
    // `store.getBounds()` to be non-null and therefore returns
    // {"error":"map not ready"} forever in this state.
    //
    // Repro: see forceNoWebGL2() in e2e/helpers.ts (monkey-patches
    // HTMLCanvasElement.prototype.getContext("webgl2") to return null before
    // the page's own scripts run) -- no CI-specific environment needed.
    test.fail();

    await forceNoWebGL2(page);
    await page.goto("/");
    await waitForTools(page);
    const state = await callTool(page, "get_map_state");
    expect(state.bounds).not.toBeNull();
  });
});
