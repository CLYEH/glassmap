/**
 * T-104 -- a corridor change must not cancel the flight it interrupts.
 *
 * The defect: `set_map_view` as the FIRST tool call on a fresh page returned
 * the new camera, but the map itself snapped back to the landing view within
 * ~550ms. That first call is also the one that wakes the chrome (the
 * inspector lane opens -- `src/lib/awaken/`'s mode flips idle -> waking on the
 * very first `recordActivity`), and `MapCanvas.tsx`'s own padding effect
 * (`subscribeChromeVisible`) reacts to that flip by calling `map.setPadding`,
 * which in maplibre-gl 6 is `jumpTo({padding})` -- and `jumpTo` opens with
 * `this.stop()`. An ease already in flight is cancelled at whatever frame it
 * had reached, firing `moveend` SYNCHRONOUSLY with the pre-flight camera, and
 * (before the fix) `pushViewFromMap` believed it: the store's `view` was
 * overwritten back to the landing camera, and nothing re-flew. The fix (the
 * comment block above `applyPadding` in `MapCanvas.tsx`) re-issues the flight
 * toward the same target when a corridor change interrupts one still in the
 * air.
 *
 * This suite's own default network isolation (`fixtures.ts`) is exactly why
 * T-104 was invisible to the existing e2e suite: with no basemap style
 * `applyView` calls `map.jumpTo` (no animation, nothing to cancel; see
 * `redesign-corridor-bounds.spec.ts`'s own note on this). Every test below
 * mocks a minimal-but-valid style document, the same escape hatch
 * `place-details.spec.ts` uses, so MapLibre actually runs a render loop and
 * `flyTo` actually eases -- the only way this defect can exist at all.
 *
 * A trap this file's own history fell into once, worth naming: `set_map_view`
 * writes `store.view` (`center`/`zoom`/...) SYNCHRONOUSLY, the instant the
 * tool runs -- that is what lets its own JSON answer report the new camera
 * before a single animation frame has run. Polling `get_map_state().zoom`
 * alone therefore resolves immediately on BOTH the broken and the fixed
 * build, and proves nothing: only the LIVE map (`window.__glassmapMap`,
 * dev-only handle) and `bounds` (written solely from a real `moveend`) can
 * tell a landed flight from one that never left. Every "settled" wait below
 * polls the live map directly.
 */
import type { Page } from "@playwright/test";
import { callTool } from "./mcp";
import { waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";
import { blockExternalNetwork, expect, mockExternalHost, test } from "./fixtures";

/** "Daan" MRT station (osm:node:3494960748, public/data/mrt-stations.geojson) --
 * the same alias the rest of this codebase's own tests resolve "Daan Station"
 * to (activity.test.ts, place-race.test.ts). Real, shipped data, not a
 * fixture: the whole point is a real `flyTo` over a real distance.
 */
const DAAN_STATION = { lng: 121.54355, lat: 25.03333 };
const PLACE_ZOOM = 15;

/** Same mock as `place-details.spec.ts:57` -- a minimal-but-valid style
 * document is enough for MapLibre to fire `load` and run a real render loop,
 * without this suite ever depending on a third-party CDN's uptime.
 */
const BASEMAP_HOST = "tiles.openfreemap.org";

/**
 * Registers the tiles mock. On the default `page`/`context` this only needs
 * to declare the host to `blockedRequests` (fixtures.ts's own auto fixture
 * already blocks every other non-localhost request there). A page opened
 * through a manually-created `browser.newContext()` has none of that
 * protection, so `blockExternalNetwork` must be applied to it FIRST -- routes
 * on the same page match in REVERSE registration order (Playwright's own
 * rule: the last-registered handler runs first), so registering the blanket
 * abort before this specific mock is what lets the mock's `fulfill` win for
 * `tiles.openfreemap.org` while every other host on that page still gets
 * aborted rather than silently reaching the real network.
 */
async function mockMinimalBasemap(page: Page, mockedExternalHosts: Set<string>): Promise<void> {
  mockExternalHost(mockedExternalHosts, BASEMAP_HOST);
  await page.route(`**/${BASEMAP_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
}

/**
 * A page with a real, loaded map and NO tool call yet -- `map-status` only
 * reaches "ready" on MapLibre's `load` event, which fires strictly after
 * `style.load` (MapCanvas.tsx), so this also guarantees `styleLoaded` is
 * already true and `flyTo` will actually ease rather than jump. Asserts idle
 * chrome on the way out: this suite's whole premise is the FIRST tool call,
 * and every caller below depends on nothing having touched the map before it
 * makes that call itself.
 */
async function goReadyCold(page: Page): Promise<void> {
  await page.goto("/");
  await waitForTools(page);
  await waitForFeatures(page);
  await waitForLiveMap(page);
  await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });
  expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");
}

/** The live map's own camera -- not the store's, which `set_map_view` writes
 * synchronously regardless of whether the camera has actually arrived there.
 */
async function liveCamera(page: Page): Promise<{ lng: number; lat: number; zoom: number }> {
  return page.evaluate(() => {
    const map = window.__glassmapMap!;
    const center = map.getCenter();
    return { lng: center.lng, lat: center.lat, zoom: map.getZoom() };
  });
}

/**
 * Waits until the LIVE map itself has stopped moving at (approximately) the
 * target zoom -- `map.isMoving()` false and `map.getZoom()` within 0.01 of
 * `targetZoom`. Reading `window.__glassmapMap` directly rather than polling
 * `get_map_state` is deliberate (see this file's top-of-file note): the store
 * already reports the target the instant the tool runs, so only the live map
 * can distinguish "commanded" from "arrived".
 */
async function waitForLiveArrival(page: Page, targetZoom: number, timeoutMs = 6000): Promise<void> {
  await page.waitForFunction(
    (zoom) => {
      const map = window.__glassmapMap;
      return !!map && !map.isMoving() && Math.abs(map.getZoom() - zoom) < 0.01;
    },
    targetZoom,
    { timeout: timeoutMs },
  );
}

test.describe("the Awakening does not cancel the first flight (T-104)", () => {
  // Desktop tier throughout (globals.css: the 336px lane only applies above
  // 1240px), and the exact canvas width the corridor-pixel checks below
  // reason about.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("set_map_view as the very first tool call still lands at its own target, on screen and in the tool's own answer", async ({
    page,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyCold(page);

    // The cold path the defect lived in: this is the first tool call this
    // page has ever made, so it is also the call that wakes the chrome.
    const flown = await callTool(page, "set_map_view", { place: "Daan Station" });
    expect(flown.error).toBeUndefined();
    expect(flown.zoom).toBe(PLACE_ZOOM);
    expect(flown.center!.lng).toBeCloseTo(DAAN_STATION.lng, 4);
    expect(flown.center!.lat).toBeCloseTo(DAAN_STATION.lat, 4);

    // The failure shape, checked fast rather than only after the full poll
    // budget: on the broken build the live camera is back at the LANDING
    // zoom (12) within ~550ms and never leaves it again, so even this loose,
    // early check already tells the two builds apart.
    await page.waitForTimeout(1000);
    const midFlight = await liveCamera(page);
    expect(midFlight.zoom).not.toBeCloseTo(12);

    // The regression itself: on the broken build the live map never reaches
    // zoom 15 at all -- this times out loud rather than being waited past.
    await waitForLiveArrival(page, PLACE_ZOOM);
    const landed = await liveCamera(page);
    expect(landed.lng).toBeCloseTo(DAAN_STATION.lng, 4);
    expect(landed.lat).toBeCloseTo(DAAN_STATION.lat, 4);

    // The store agrees with the live map it is supposed to be describing --
    // not merely with the value the tool wrote before the flight even began.
    const settled = await callTool(page, "get_map_state");
    expect(settled.error).toBeUndefined();
    expect(settled.center).toEqual(flown.center);
    expect(settled.zoom).toBe(PLACE_ZOOM);

    // The visible half: the human-readable camera chip (BrandBar.tsx) agrees
    // with the JSON a tool just returned -- the project's own law that
    // whatever an agent can read, a person can see on the page.
    await expect(page.getByTestId("camera-readout")).toContainText("z15");
  });

  test("the settled camera sits in the padded corridor, not the full canvas -- a cold first call agrees with an already-awake control to 5 decimals", async ({
    page,
    browser,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyCold(page);

    // Cold: `set_map_view` is the first tool call, so the flight and the
    // corridor's arrival race in the same tick -- exactly the defect.
    const coldFlown = await callTool(page, "set_map_view", { place: "Daan Station" });
    expect(coldFlown.error).toBeUndefined();
    await waitForLiveArrival(page, PLACE_ZOOM);
    const cold = await callTool(page, "get_map_state");
    expect(cold.error).toBeUndefined();
    expect(cold.bounds).not.toBeNull();

    // Warm control, in a second page: a read call wakes the chrome and lands
    // (`get_map_state` alone never starts a flight, so there is nothing for
    // that corridor change to interrupt), THEN the identical `set_map_view`
    // runs on an already-awake page -- the case T-104's own report says was
    // always fine. Same viewport, same style mock, same target; the only
    // variable this isolates is whether the flight and the wake collided.
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await context2.newPage();
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));
    // Order matters (see mockMinimalBasemap's own doc comment): the blanket
    // abort first, the specific tiles mock second, so the mock wins for
    // tiles.openfreemap.org while every other host on this manually-created
    // page/context still gets aborted rather than reaching the real network.
    await blockExternalNetwork(page2);
    await mockMinimalBasemap(page2, mockedExternalHosts);
    await goReadyCold(page2);

    const warmUp = await callTool(page2, "get_map_state");
    expect(warmUp.error).toBeUndefined();
    await expect
      .poll(() => page2.evaluate(() => document.body.dataset.awaken))
      .not.toBe("idle");

    const warmFlown = await callTool(page2, "set_map_view", { place: "Daan Station" });
    expect(warmFlown.error).toBeUndefined();
    await waitForLiveArrival(page2, PLACE_ZOOM);
    const warm = await callTool(page2, "get_map_state");
    expect(warm.error).toBeUndefined();
    await context2.close();
    expect(errors2).toEqual([]);

    // The equality itself is the regression test: on the broken build `cold`
    // never reaches this target at all (previous test), but a build that
    // "fixed" T-104 by, say, always re-flying regardless of corridor could
    // still land the CENTRE right while getting the CORRIDOR wrong (padding
    // applied to the wrong moment, or not republished after the re-fly).
    // Comparing full state -- center, zoom AND bounds -- against a control
    // that never raced the wake at all closes that gap.
    expect(cold.center).toEqual(warm.center);
    expect(cold.zoom).toBe(warm.zoom);
    expect(cold.bounds).toEqual(warm.bounds);

    // Not the full 1280px canvas: asking the live map itself (not a
    // recomputation of `visibleBounds`'s own formula) where `bounds.east`
    // projects to must land ~336px inside the 1280px canvas -- the inspector
    // lane's own width (globals.css `--lane: 336px` at desktop) -- not at the
    // canvas's true edge, which is what a padding-less corridor would report.
    const eastPixelX = await page.evaluate(
      (lng) => window.__glassmapMap!.project([lng, window.__glassmapMap!.getCenter().lat]).x,
      cold.bounds!.east,
    );
    expect(eastPixelX).toBeGreaterThan(900);
    expect(eastPixelX).toBeLessThan(960);
  });

  test("a mid-flight window resize keeps the flight's own target and republishes bounds at the new canvas width", async ({
    page,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyCold(page);

    // Same cold first call: starts the flight AND wakes the chrome, so the
    // corridor pads once already before the resize below pads it again.
    const flown = await callTool(page, "set_map_view", { place: "Daan Station" });
    expect(flown.error).toBeUndefined();

    // The corridor before the resize below, still at the 1280px canvas this
    // page opened with -- the value the resize is supposed to move `bounds`
    // AWAY from, not merely agree with once the flight eventually lands.
    const beforeResize = await callTool(page, "get_map_state");
    expect(beforeResize.error).toBeUndefined();
    expect(beforeResize.bounds).not.toBeNull();

    // Mid-flight, a second corridor change from an entirely different cause:
    // `applyPadding` also runs on `resize` (MapCanvas.tsx), and the fix's
    // `flying` guard has to re-fly regardless of which of the two callers
    // interrupted the ease. 1440px stays inside the same >1240px lane tier
    // (globals.css) -- the lane itself stays 336px, so only the CANVAS width
    // changes (944px corridor -> 1104px), isolating this from a lane-width
    // change.
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Read back WHILE the flight is still in the air -- the ~2s ease is
    // nowhere near done at 300ms in, and this read is one fast `page.evaluate`
    // round trip, so this samples well before `waitForLiveArrival` below ever
    // resolves. `onResize`'s own `pushBoundsFromMap()` call is the only thing
    // that can have moved `bounds` already: the flight's own `moveend` -- the
    // other path that republishes bounds -- has not fired yet, and won't for
    // another second or more. Without that line `bounds` would still equal
    // `beforeResize.bounds` here, describing a canvas 160px narrower than the
    // one actually on screen, until the flight happens to land on its own.
    const midResize = await callTool(page, "get_map_state");
    expect(midResize.error).toBeUndefined();
    expect(midResize.bounds).not.toEqual(beforeResize.bounds);

    await waitForLiveArrival(page, PLACE_ZOOM);
    const settled = await callTool(page, "get_map_state");
    expect(settled.error).toBeUndefined();
    expect(settled.center!.lng).toBeCloseTo(flown.center!.lng, 4);
    expect(settled.center!.lat).toBeCloseTo(flown.center!.lat, 4);
    expect(settled.bounds).not.toBeNull();

    // Bounds describe the NEW 1440px canvas, not the 1280px one the flight
    // started under: corridor right edge = 1440 - 336 = 1104px.
    const eastPixelX = await page.evaluate(
      (lng) => window.__glassmapMap!.project([lng, window.__glassmapMap!.getCenter().lat]).x,
      settled.bounds!.east,
    );
    expect(eastPixelX).toBeGreaterThan(1060);
    expect(eastPixelX).toBeLessThan(1130);
  });

  test("a hand drag mid-flight is not overwritten by the chrome arriving: the human's own gesture wins", async ({
    page,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyCold(page);

    // Same cold first call as above: starts the flight AND wakes the chrome.
    const flown = await callTool(page, "set_map_view", { place: "Daan Station" });
    expect(flown.error).toBeUndefined();

    // Mid-flight (the ~2s ease is nowhere near done): take the wheel. A real
    // pointer drag over the live canvas -- MapLibre's own `dragPan` handler
    // calls `this.stop()` on `mousedown`, cancelling the ease exactly the way
    // `applyPadding`'s `jumpTo`-induced `stop()` does, but this one MUST be
    // allowed to win: `flying` (MapCanvas.tsx) is cleared by this gesture's
    // own `moveend`, and no later corridor change may treat the agent's old
    // target as still owed.
    //
    // The LIVE camera, not the store's: `get_map_state().center` right now
    // would still read the agent's TARGET (Daan Station) -- `set_map_view`
    // writes it synchronously before a single animation frame runs (this
    // file's own top-of-file note), and this flight is nowhere near landing.
    // Measuring the drag's delta off that target, rather than off where the
    // hand actually started, would pass even if the drag below were a no-op:
    // the flight alone would already account for the whole "distance".
    const beforeDrag = await liveCamera(page);
    const box = await page.getByTestId("map").boundingBox();
    if (!box) throw new Error("map container has no box to drag over");
    const startX = box.x + box.width * 0.3;
    const startY = box.y + box.height * 0.5;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 160, startY + 120, { steps: 12 });
    await page.mouse.up();
    // Let any drag inertia settle before reading the position back.
    await page.waitForTimeout(400);

    const afterDrag = await callTool(page, "get_map_state");
    expect(afterDrag.error).toBeUndefined();
    // The drag itself really moved the camera off its OWN pre-drag position --
    // a real geographic delta, not merely "the flight got interrupted
    // somewhere else on its own ease" (mousedown alone would do that with no
    // pixel of pan at all). At any zoom this flight passes through, a
    // 160x120px pan is orders of magnitude larger than this threshold.
    const dragDelta =
      Math.abs(afterDrag.center!.lng - beforeDrag.lng) + Math.abs(afterDrag.center!.lat - beforeDrag.lat);
    expect(dragDelta).toBeGreaterThan(1e-3);

    // A real corridor change after the drag, not another read call: `flying`
    // is false now (the drag's own `moveend` cleared it), so `onResize` must
    // take the NOT-flying branch and never re-fly toward the agent's old
    // target. This is exactly the shape of event the `flying` guard exists to
    // withstand -- a resize arriving after a human already took the wheel --
    // and unlike a bare read call, a resize genuinely runs `onResize`.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);

    const settled = await callTool(page, "get_map_state");
    expect(settled.error).toBeUndefined();

    // The human's hand wins: nothing moved the camera again after the drag,
    // not even the resize above.
    expect(settled.center).toEqual(afterDrag.center);
    expect(settled.zoom).toBe(afterDrag.zoom);

    // And specifically: the camera did NOT snap back to the agent's original
    // target -- the exact regression this guard exists to prevent.
    const distanceFromTarget =
      Math.abs(settled.center!.lng - DAAN_STATION.lng) + Math.abs(settled.center!.lat - DAAN_STATION.lat);
    expect(distanceFromTarget).toBeGreaterThan(1e-3);
  });
});
