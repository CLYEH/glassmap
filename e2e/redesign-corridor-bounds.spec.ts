/**
 * T-54 -- locks PR #36's MAJOR fix: `get_map_state.bounds` must describe the
 * visible corridor beside the inspector, not the whole (partly covered)
 * canvas -- so its midpoint has to land exactly on `center.lng`.
 *
 * `viewport-bounds.test.ts` already proves the pure `visibleBounds`/
 * `approximateBounds` maths does this given fabricated width/lane/unproject
 * inputs. What that unit test cannot see is the integration: does
 * `inspectorLane()` read the real `--lane` custom property at each real CSS
 * breakpoint, does `map.setPadding({ right: lane })` actually get applied to
 * a real MapLibre map, and does a real `moveend` republish `bounds` in step
 * with `center`. This file drives a real browser at three widths that each
 * land in a different `--lane` tier (globals.css): 1440 -> 336px lane (full
 * desktop), 1000 -> 300px lane (921-1240 mid tier), 800 -> 0px lane (<=920
 * sheet tier, inspector becomes a bottom sheet and stops covering the map).
 */
import { callTool } from "./mcp";
import { waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/** Poll until the map has rendered at least one real viewport. */
async function waitForBounds(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
  );
}

const CORRIDOR_WIDTHS = [
  { width: 1440, lane: "336px lane, full desktop" },
  { width: 1000, lane: "300px lane, mid tier" },
  { width: 800, lane: "0px lane, sheet tier" },
];

test.describe("visible-corridor bounds (T-54 / PR #36)", () => {
  for (const { width, lane } of CORRIDOR_WIDTHS) {
    test(`center sits at the bounds midpoint at ${width}px (${lane})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await waitForTools(page);
      await waitForLiveMap(page);
      await waitForBounds(page);

      const state = await callTool(page, "get_map_state");
      expect(state.bounds).not.toBeNull();
      expect(state.center).toBeDefined();

      const midLng = (state.bounds!.west + state.bounds!.east) / 2;
      expect(midLng).toBeCloseTo(state.center!.lng, 5);
    });
  }

  test("hiding the inspector (sidebar-toggle) does not move the reported bounds", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await waitForBounds(page);

    const before = await callTool(page, "get_map_state");
    expect(before.bounds).not.toBeNull();

    // The Hide button only empties the panel's body (Inspector.tsx); the
    // glass sheet keeps covering the same lane either way, so
    // MapCanvas.tsx's padding -- and therefore the corridor bounds
    // publishes -- must not react to it at all.
    await page.getByTestId("sidebar-toggle").click();
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");

    const after = await callTool(page, "get_map_state");
    expect(after.bounds).toEqual(before.bounds);
    expect(after.center).toEqual(before.center);

    const midLng = (after.bounds!.west + after.bounds!.east) / 2;
    expect(midLng).toBeCloseTo(after.center!.lng, 5);
  });

  test("center stays at the bounds midpoint after a set_map_view flight settles", async ({ page }) => {
    // KNOWN DEFECT, found while writing this test (T-54) -- reported, not
    // fixed here (out of e2e/** ownership; belongs to map-ui-dev,
    // src/components/MapCanvas.tsx).
    //
    // Repro: under this suite's default network isolation (fixtures.ts,
    // T-13 -- the basemap style fetch always fails, map-status: "error"),
    // calling set_map_view a second time (after the map's first camera is
    // already established) starts a `flyTo` whose animation never
    // completes: `movestart` fires once, `moveend` never does, and
    // `map.getCenter()` stays frozen at the PRE-flight position indefinitely
    // (measured: still frozen 3s later; probed with `E2E_LIVE_BASEMAP=1`,
    // a real reachable basemap, in the same headless browser -- there
    // `moveend` fires normally and the camera reaches its target, isolating
    // the cause to "style never loaded", not headless rAF throttling).
    //
    // MapCanvas.tsx's `pushViewFromMap` (the only writer of `bounds`, called
    // from the constructor once and from `map.on("moveend", ...)`
    // thereafter) is therefore never called again, so `bounds` stays stuck
    // at whatever it was before the failed flight -- forever, for the rest
    // of the session. Meanwhile `center` in the SAME get_map_state answer
    // keeps reporting the new position (`store.setView` writes it directly,
    // independent of the live map). Expected: `bounds`'s midpoint converges
    // on the new `center.lng` once the flight settles, per PR #36's
    // corridor-bounds invariant. Actual: it never converges -- an agent
    // calling set_map_view then get_map_state, on a page whose basemap
    // failed to load, gets a `center` and a `bounds` describing two
    // different places, permanently.
    //
    // This is not a network-isolation-only curiosity: "every tool still
    // working when the basemap style/tiles never load" is a documented
    // product guarantee (data-and-view.spec.ts), and any real user/agent
    // whose CDN request is briefly unreachable hits exactly this state.
    test.fail(
      true,
      "MapCanvas.tsx: flyTo never fires moveend once the basemap failed to load, so bounds freezes and desyncs from center after any subsequent set_map_view -- see the comment above for the full repro",
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForBounds(page);

    const flown = await callTool(page, "set_map_view", {
      center: { lng: 121.53, lat: 25.05 },
      zoom: 14,
    });
    expect(flown.error).toBeUndefined();

    // flyTo settles asynchronously (moveend), and MapCanvas only republishes
    // `bounds` once it does -- reading it back once right after the call
    // would race a still-flying camera (see e2e/helpers.ts stableState /
    // share-link.spec.ts's own hash-convergence poll for the identical
    // reasoning). Poll the DECODED relationship (does the midpoint match the
    // requested centre) until it converges, rather than strict-equalling one
    // snapshot of two independently-written fields.
    await expect
      .poll(
        async () => {
          const state = await callTool(page, "get_map_state");
          if (!state.bounds || !state.center) return "not ready";
          const midLng = (state.bounds.west + state.bounds.east) / 2;
          return {
            centerMatchesRequest: state.center.lng === flown.center!.lng,
            midMatchesCenter: Math.abs(midLng - state.center.lng) < 5e-6,
          };
        },
        { message: "bounds midpoint should converge on the flown-to centre", timeout: 4000 },
      )
      .toEqual({ centerMatchesRequest: true, midMatchesCenter: true });
  });
});
