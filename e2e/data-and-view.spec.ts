import { callTool } from "./mcp";
import { FEATURE_COUNT, forceNoWebGL2, waitForFeatures, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * T-13 items 1 + 3: feature data and the visible bounds must be readable
 * through the tools -- and agree with the DOM -- independent of whether
 * MapLibre itself ever finishes rendering. A real client may call a tool
 * before the map reaches "ready", and headless CI has no working WebGL at
 * all (see MapCanvas.tsx `hasWebGL2()`), so these assertions must hold
 * whatever `map-status` says.
 */
test.describe("data + view state", () => {
  test("2063 features load; get_map_state agrees with the DOM, bounds included", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await expect(page.getByTestId("feature-count")).toHaveText(String(FEATURE_COUNT));
    // Give the map effect (a dynamic import, so not guaranteed to have run
    // yet just because window.__glassmap exists -- see the race documented
    // below) every chance to have set bounds before we read it.
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

    const status = await page.getByTestId("map-status").textContent();
    expect(["loading", "ready", "error", "unavailable"]).toContain(status);

    expect(pageErrors).toEqual([]);
  });

  test("bounds becomes available without waiting for map-status to reach ready", async ({
    page,
    pageErrors,
  }) => {
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
    // at all, which should not happen on this code path (WebGL is real here).
    expect(statusWhenBoundsAppeared).not.toBe("unavailable");

    const state = await callTool(page, "get_map_state");
    expect(state.bounds).not.toBeNull();

    expect(pageErrors).toEqual([]);
  });

  test("bounds never becomes available once WebGL2 is unavailable", async ({ page, pageErrors }) => {
    // This documents a real product defect rather than a flaky assertion, so
    // it is marked `test.fail()`: Playwright records it as an expected
    // failure (the suite stays green) while the underlying assertion below
    // genuinely fails and is not weakened to pass.
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
    await expect(page.getByTestId("map-status")).toHaveText("unavailable");

    // Data loading does not depend on WebGL: this part of "tools keep
    // working without the map" does hold.
    await waitForFeatures(page);
    const state = await callTool(page, "get_map_state");
    expect(state.features_loaded).toBe(FEATURE_COUNT);

    expect(state.bounds).not.toBeNull();

    expect(pageErrors).toEqual([]);
  });
});
