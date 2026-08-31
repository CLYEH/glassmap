/**
 * `set_map_view({fit})` -- the second half of T-102's reverse parity.
 *
 * T-101 gave a human's inspector row a camera that respects what it is
 * clicking: an area is framed whole (widening out if it must), a point flies
 * to its coordinate and never zooms out past a floor. Until T-102 an agent
 * had no equivalent -- `feature_id`/`place` always jump to one fixed zoom, so
 * "frame the district I'm standing in" was not expressible at all. `fit`
 * closes that gap by calling the exact function the row click calls
 * (`frameFor`, `src/lib/geo/frame.ts`), not a re-implementation of it.
 *
 * The pure maths and every refusal (`fit`+`zoom`, `fit`+`center`/`place`/
 * `feature_id`, an unknown drawing or feature id, "map not ready") already
 * have thorough unit coverage against a fixture store
 * (`src/lib/map-tools/map-tools.test.ts`, `describe("set_map_view fit")`).
 * What that suite cannot see is the one thing this file exists to prove: the
 * REAL registered tool, called through `document.modelContext` the way a
 * client actually calls it, moving a REAL MapLibre map, landing on the exact
 * same camera a REAL click on the T-101 row produces -- not "both call
 * `frameFor`" as a fact about the source, but as a fact about two live DOM
 * interactions on the same page.
 */
import { callTool } from "./mcp";
import { expect, test } from "./fixtures";
import { waitForAwake, waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

/**
 * Daan Station (`public/data/mrt-stations.geojson`), a bundled point feature
 * with no extent. Copied from `inspector-actions.spec.ts` rather than
 * imported, for the reason that file's own header gives for its constants:
 * this suite stays free of a dependency on another spec file.
 */
const DAAN_STATION = { id: "osm:node:3494960748", lng: 121.54355, lat: 25.03333 };

/**
 * Wanhua district (`public/data/districts.geojson`, `district:wanhua`).
 * Bounds/centre copied from `inspector-actions.spec.ts`'s own independent
 * min/max walk of the raw polygon, not re-derived from `geometryBounds` --
 * see that file's header for why. `INSIDE_WANHUA` is a coordinate verified to
 * sit inside the polygon itself, not just its bbox.
 */
const WANHUA = {
  id: "district:wanhua",
  bounds: { west: 121.48332, south: 25.00915, east: 121.51289, north: 25.0497 },
  center: { lng: 121.49811, lat: 25.02943 },
};
const INSIDE_WANHUA = { lng: 121.5, lat: 25.03 };

/** Wakes the chrome with a read that changes nothing else, so `sidebar-*` mounts. */
async function wakeChrome(page: import("@playwright/test").Page): Promise<void> {
  const result = await callTool(page, "get_map_state");
  expect(result.error).toBeUndefined();
  expect(await waitForAwake(page, 2500)).toBe("awake");
}

test.describe("set_map_view({fit}) -- area framing (T-102)", () => {
  test("fits a hand-drawn polygon with room to spare, and lands exactly where the same drawing's T-101 row click would", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);
    await wakeChrome(page);

    const before = await callTool(page, "get_map_state");
    expect(before.error).toBeUndefined();

    // A plain square, so containment is exactly [lng-h, lat-h, lng+h, lat+h] --
    // no independent bbox maths needed to know what "frames it" should mean.
    const CENTER = { lng: 121.5, lat: 25.03 };
    const HALF = 0.01;
    const drawing = await page.evaluate(
      ({ center, half }) =>
        window.__glassmapStore!.getState().addDrawing({
          source: "user",
          kind: "polygon",
          label: "fit-parity square",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [center.lng - half, center.lat - half],
                [center.lng + half, center.lat - half],
                [center.lng + half, center.lat + half],
                [center.lng - half, center.lat + half],
                [center.lng - half, center.lat - half],
              ],
            ],
          },
        }),
      { center: CENTER, half: HALF },
    );
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    const fitted = await callTool(page, "set_map_view", { fit: drawing.id! });
    expect(fitted.error).toBeUndefined();

    // Contains the whole square...
    expect(fitted.bounds!.west).toBeLessThanOrEqual(CENTER.lng - HALF);
    expect(fitted.bounds!.south).toBeLessThanOrEqual(CENTER.lat - HALF);
    expect(fitted.bounds!.east).toBeGreaterThanOrEqual(CENTER.lng + HALF);
    expect(fitted.bounds!.north).toBeGreaterThanOrEqual(CENTER.lat + HALF);
    // ...strictly, not flush against its edges: ROW_FIT_FILL (0.8) leaves a
    // margin on every side, so a fit is a frame and not a crop.
    expect(fitted.bounds!.west).toBeLessThan(CENTER.lng - HALF);
    expect(fitted.bounds!.east).toBeGreaterThan(CENTER.lng + HALF);
    expect(fitted.zoom!).toBeGreaterThan(before.zoom!);
    expect(fitted.center).toEqual(CENTER);

    // Put the camera back exactly where it was before the tool moved it, so
    // the row click below computes `frameFor` over the identical (view,
    // corridor) pair the tool call did -- the only way the comparison that
    // follows can mean anything.
    const reset = await callTool(page, "set_map_view", {
      center: before.center,
      zoom: before.zoom,
      bearing: before.bearing,
      pitch: before.pitch,
    });
    expect(reset.error).toBeUndefined();

    // THE PARITY ASSERTION. T-101's own row click, same drawing, same
    // starting camera: `frameFor` is one function, so this has to land on the
    // exact center/zoom the tool call above returned -- not "close", equal.
    await page.locator(`[data-testid="zoom-to-drawing"][data-drawing-id="${drawing.id}"]`).click();
    const afterClick = await callTool(page, "get_map_state");
    expect(afterClick.center).toEqual(fitted.center);
    expect(afterClick.zoom).toBe(fitted.zoom);
  });

  test("fitting a district bigger than the current view zooms OUT, and contains its whole bbox", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    // Standing on one of Wanhua's own street corners, zoomed to a building.
    const tight = await callTool(page, "set_map_view", { center: INSIDE_WANHUA, zoom: 17 });
    expect(tight.error).toBeUndefined();

    const out = await callTool(page, "set_map_view", { fit: WANHUA.id });
    expect(out.error).toBeUndefined();
    // A fit that refused to widen would answer "show me 萬華區" from inside it
    // with the same street corner it started on.
    expect(out.zoom!).toBeLessThan(17);
    expect(out.center).toEqual(WANHUA.center);
    expect(out.bounds!.west).toBeLessThanOrEqual(WANHUA.bounds.west);
    expect(out.bounds!.south).toBeLessThanOrEqual(WANHUA.bounds.south);
    expect(out.bounds!.east).toBeGreaterThanOrEqual(WANHUA.bounds.east);
    expect(out.bounds!.north).toBeGreaterThanOrEqual(WANHUA.bounds.north);
  });
});

test.describe("set_map_view({fit}) -- point targets (T-102)", () => {
  test("fitting a point feature from a normal (sub-floor) zoom matches feature_id exactly", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    // Default zoom is 12 (DEFAULT_VIEW), below PLACE_ZOOM/ROW_POINT_ZOOM (15):
    // this is the only regime the tool's description and its unit test
    // ("treats a point exactly as feature_id does") actually exercise -- see
    // the adversarial test below for the regime they do not.
    const before = await callTool(page, "get_map_state");
    expect(before.zoom!).toBeLessThan(15);

    const viaFit = await callTool(page, "set_map_view", { fit: DAAN_STATION.id });
    expect(viaFit.error).toBeUndefined();

    const reset = await callTool(page, "set_map_view", {
      center: before.center,
      zoom: before.zoom,
      bearing: before.bearing,
      pitch: before.pitch,
    });
    expect(reset.error).toBeUndefined();

    const viaId = await callTool(page, "set_map_view", { feature_id: DAAN_STATION.id });
    expect(viaId.error).toBeUndefined();

    expect(viaFit.center).toEqual(viaId.center);
    expect(viaFit.zoom).toBe(viaId.zoom);
    expect(viaFit.zoom).toBe(15);
  });

  /**
   * DEFECT (found while writing this parity test, not by the orchestrator's
   * brief): `set_map_view`'s own schema says `fit` on a target with no extent
   * "behaves exactly like feature_id: it flies there and never zooms out past
   * PLACE_ZOOM" (src/lib/map-tools/index.ts, the `fit` property description,
   * and the tool description's own sentence). That is only true when the
   * camera starts at or below PLACE_ZOOM (15) -- which is the only regime the
   * unit test "treats a point exactly as feature_id does" exercises
   * (map-tools.test.ts:503, whose fixture VIEW.zoom is 14).
   *
   * Above that floor the two paths diverge, because they are not actually the
   * same rule:
   *  - `fit` on a point resolves through `frameFor`, whose no-extent branch is
   *    `Math.max(view.zoom, ROW_POINT_ZOOM)` -- a FLOOR. Starting at zoom 18,
   *    it stays at 18.
   *  - `feature_id` (src/lib/map-tools/index.ts, the `hasFeatureId` branch) is
   *    `patch.zoom = patch.zoom ?? PLACE_ZOOM` -- an unconditional default
   *    applied whenever the caller did not also pass an explicit `zoom`.
   *    Starting at zoom 18, it resets to 15.
   *
   * Repro: start at zoom 18 well away from the station; `fit: DAAN_STATION.id`
   * keeps zoom 18 (correct per the floor rule, and per "never zooms out past
   * PLACE_ZOOM" read literally -- 18 is not "past" 15 in the zoomed-IN
   * direction); `feature_id: DAAN_STATION.id` from the identical starting
   * camera lands on zoom 15 -- an actual zoom-OUT the parity claim does not
   * mention and the existing unit test cannot see, because its fixture never
   * starts above the floor.
   *
   * Reported rather than fixed (QA does not touch `src/lib/map-tools/**`):
   * either widen `feature_id`'s own default to a floor (`Math.max(current,
   * PLACE_ZOOM)`) to genuinely match `fit`, or narrow the tool description's
   * claim to "at or below PLACE_ZOOM, fit and feature_id agree" and stop
   * calling it "exactly like feature_id" without qualification.
   *
   * `test.fail()` per CONTRIBUTING.md's rule for a known defect: this keeps
   * CI green while refusing to let the gap go unrecorded. If a future change
   * makes the assertion below pass, this test starts FAILING the run --
   * that is `test.fail()` doing its job, and is the cue to delete this test
   * and remove the qualifier this comment argues for.
   */
  test("known defect: fit on a point does not actually match feature_id once the camera starts past PLACE_ZOOM", async ({
    page,
  }) => {
    test.fail();
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    // Zoomed in well past PLACE_ZOOM (15) and looking at somewhere else
    // entirely, so "the camera did not move" cannot masquerade as "the floor
    // held".
    const deep = await callTool(page, "set_map_view", {
      center: { lng: 121.55, lat: 25.06 },
      zoom: 18,
    });
    expect(deep.error).toBeUndefined();

    const viaFit = await callTool(page, "set_map_view", { fit: DAAN_STATION.id });
    expect(viaFit.error).toBeUndefined();

    const reset = await callTool(page, "set_map_view", {
      center: deep.center,
      zoom: deep.zoom,
      bearing: deep.bearing,
      pitch: deep.pitch,
    });
    expect(reset.error).toBeUndefined();

    const viaId = await callTool(page, "set_map_view", { feature_id: DAAN_STATION.id });
    expect(viaId.error).toBeUndefined();

    expect(viaFit.center).toEqual(viaId.center);
    // This is the line that currently fails: viaFit.zoom is 18 (the floor
    // held), viaId.zoom is 15 (feature_id's unconditional default fired).
    expect(viaFit.zoom).toBe(viaId.zoom);
  });
});

test.describe("set_map_view({fit}) -- refusals against the real store (T-102)", () => {
  test("fit combined with zoom is refused, and an unknown drawing id answers with the ids that do exist", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: { lng: 121.5, lat: 25.03 },
      radius_m: 150,
    });
    expect(drawn.error).toBeUndefined();
    const drawingId = drawn.drawing_id!;

    const withZoom = await callTool(page, "set_map_view", { fit: drawingId, zoom: 18 });
    expect(withZoom.error).toMatch(/either fit or zoom/);

    const unknown = await callTool(page, "set_map_view", { fit: "drawing:not-a-real-id" });
    expect(unknown.error).toBe("unknown drawing id: drawing:not-a-real-id");
    expect(unknown.known_ids).toEqual([drawingId]);
  });

  /**
   * (e) `fit` before the map has reported a rectangle at all -- the "map not
   * ready" refusal already unit-tested against a fixture store
   * (map-tools.test.ts:569). The natural window for this ("before
   * `waitForLiveMap`") is not one this suite can drive on purpose: MapCanvas
   * is a `next/dynamic` import whose constructor-time `setBounds()` lands at
   * an unpredictable moment relative to `window.__glassmap` appearing
   * (`helpers.ts`'s own comment on `waitForLiveMap`), and racing it has
   * already produced flaky failures diagnosed independently twice
   * (`fx.spec.ts`'s "kill switch" test, `webmcp.spec.ts`'s back-to-back
   * reads). Adding a third race here would trade one flaky test for another
   * rather than test the refusal.
   *
   * The honest, deterministic way to reach the exact store state the tool
   * actually branches on (`store.getBounds() === null`) is to drive the same
   * setter MapCanvas itself calls, once the map is otherwise fully up --
   * indistinguishable, from `set_map_view`'s point of view, from asking
   * before the map ever reported a rectangle.
   */
  test("fit says the map is not ready rather than guessing, once bounds is unavailable", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: { lng: 121.5, lat: 25.03 },
      radius_m: 150,
    });
    expect(drawn.error).toBeUndefined();

    await page.evaluate(() => window.__glassmapStore!.getState().setBounds(null));

    const out = await callTool(page, "set_map_view", { fit: drawn.drawing_id! });
    expect(out.error).toBe("map not ready");
  });
});
