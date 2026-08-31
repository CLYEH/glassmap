/**
 * T-101 -- the Inspector's rows answer to a click (`src/components/Inspector.tsx`,
 * `frame-model.ts`, `selection-model.ts`). The unit suite already proves the
 * pure camera maths (`frame-model.test.ts`) and the row-resolution contract
 * (`selection-model.test.ts`, `viewport-bounds.test.ts`) against fabricated
 * boxes with no DOM. What this file adds is the part those suites cannot see:
 * a real row, a real click (or a real keypress) through a real store, and the
 * two document facts a person or an agent actually reads back --
 * `get_map_state`'s own JSON and the DOM the row rendered -- agreeing with
 * each other.
 *
 * The camera writes here are a human's own hand on their own map
 * (`frame-model.ts`'s own contract: `setView` is the write a pan makes, no
 * tool runs). Every test that reads `activity.length` is there to prove that
 * contract, not to restate it: a regression that routed a row click through
 * `recordActivity` would silently start telling the agent about a gesture it
 * had no part in.
 *
 * Agent chrome (the sidebar itself) mounts only once the page is awake
 * (`page.tsx`), so every test wakes it with one inert tool call first -- the
 * same pattern `remove-from-map.spec.ts` and `awakening.spec.ts` use --
 * before it ever looks for a `sidebar-*` testid.
 */
import { callTool } from "./mcp";
import { waitForAwake, waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * Two real, bundled MRT stations (`public/data/mrt-stations.geojson`) --
 * loaded from the moment the page's bundled datasets arrive, never through
 * tier-2. Coordinates copied from the file, not re-derived, so a change to
 * `frame-model.ts`'s point rule -- not a change to the fixture -- is what
 * these tests would catch.
 */
const DAAN_STATION = { id: "osm:node:3494960748", lng: 121.54355, lat: 25.03333 };
const TAIPEI_MAIN_STATION = { id: "osm:node:3495094870", lng: 121.51591, lat: 25.04747 };

/**
 * Wanhua district (`public/data/districts.geojson`, `district:wanhua`). Its
 * [west, south, east, north] and centre are computed independently of the
 * app's own `geometryBounds`/`boundsCenter` (a plain min/max walk of the raw
 * polygon coordinates, not an import of `frame-model.ts`) so a bug in that
 * module cannot cancel itself out against the value asserted here. The centre
 * is rounded with the same `round5` the tool layer applies to `get_map_state`
 * output (`state.ts`), because `(west+east)/2` lands exactly on a nickel at
 * the sixth decimal digit and half-rounds up either way.
 */
const WANHUA = {
  id: "district:wanhua",
  bounds: { west: 121.48332, south: 25.00915, east: 121.51289, north: 25.0497 },
  center: { lng: 121.49811, lat: 25.02943 },
};
/** Well inside Wanhua's polygon (verified against the shipped geometry), not just its bbox. */
const INSIDE_WANHUA = { lng: 121.5, lat: 25.03 };

/** Wakes the chrome with a read that changes nothing else, so `sidebar-*` mounts. */
async function wakeChrome(page: import("@playwright/test").Page): Promise<void> {
  const result = await callTool(page, "get_map_state");
  expect(result.error).toBeUndefined();
  expect(await waitForAwake(page, 2500)).toBe("awake");
}

test.describe("Inspector row actions (T-101)", () => {
  test("an area's row fits its whole extent, even when that means pulling the camera back out (the widening exception)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    // Standing on one of Wanhua's own street corners, zoomed to a building --
    // deliberately past ROW_FIT_MAX_ZOOM (17) is not needed; past the zoom the
    // district itself will fit at is what matters, and 17 already is.
    const tight = await callTool(page, "set_map_view", { center: INSIDE_WANHUA, zoom: 17 });
    expect(tight.error).toBeUndefined();

    const selected = await callTool(page, "select_features", {
      ids: [DAAN_STATION.id, WANHUA.id, TAIPEI_MAIN_STATION.id],
    });
    expect(selected.error).toBeUndefined();
    expect(selected.state!.selection.count).toBe(3);
    expect(await waitForAwake(page, 2500)).toBe("awake");
    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("3");

    await page.locator(`[data-testid="zoom-to-feature"][data-feature-id="${WANHUA.id}"]`).click();

    // A fit that refused to widen would answer this click with the same
    // street corner it started on; the whole point of the exception is that
    // "show me 萬華區" from inside it can only mean pulling back.
    await expect
      .poll(async () => (await callTool(page, "get_map_state")).zoom, {
        message: "clicking the district's row should widen the camera back out from zoom 17",
      })
      .toBeLessThan(17);

    const after = await callTool(page, "get_map_state");
    expect(after.center).toEqual(WANHUA.center);
    expect(after.bounds).not.toBeNull();
    expect(after.bounds!.west).toBeLessThanOrEqual(WANHUA.bounds.west);
    expect(after.bounds!.south).toBeLessThanOrEqual(WANHUA.bounds.south);
    expect(after.bounds!.east).toBeGreaterThanOrEqual(WANHUA.bounds.east);
    expect(after.bounds!.north).toBeGreaterThanOrEqual(WANHUA.bounds.north);
  });

  test("a district row's own ✕ removes only the district; the two agent-selected stations keep their provenance and the activity feed is untouched", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    const selected = await callTool(page, "select_features", {
      ids: [DAAN_STATION.id, WANHUA.id, TAIPEI_MAIN_STATION.id],
    });
    expect(selected.error).toBeUndefined();
    expect(await waitForAwake(page, 2500)).toBe("awake");
    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("3");

    const activityBefore = await page.evaluate(() => window.__glassmapStore!.getState().activity.length);

    await page.locator(`[data-testid="deselect-feature"][data-feature-id="${WANHUA.id}"]`).click();

    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("2");

    // A row's ✕ is the same human gesture the row's own click is -- nothing
    // for the agent's feed to have heard about. Read straight off the store
    // (not through a tool call) and BEFORE any further `callTool` below --
    // `withActivity` (activity.ts) wraps every tool, including read-only
    // ones, so a `get_map_state` call made to check something else would
    // silently add a row of its own and invalidate this exact assertion.
    expect(await page.evaluate(() => window.__glassmapStore!.getState().activity.length)).toBe(
      activityBefore,
    );

    const state = await callTool(page, "get_map_state");
    expect(state.selection).toEqual({ count: 2, ids: [DAAN_STATION.id, TAIPEI_MAIN_STATION.id] });

    // The human deselect must not re-attribute what it keeps: both survivors
    // were the agent's pick a moment ago and still are.
    const sources = await page.evaluate(() => window.__glassmapStore!.getState().selectionSources);
    expect(sources).toEqual({ [DAAN_STATION.id]: "agent", [TAIPEI_MAIN_STATION.id]: "agent" });
  });

  test("a hand-drawn shape's row frames its whole extent", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);
    await wakeChrome(page);

    // A plain square, so its bbox is exactly [lng-h, lat-h, lng+h, lat+h] --
    // no independent bbox maths needed to know what "frames it" should mean.
    const CENTER = { lng: 121.5, lat: 25.03 };
    const HALF = 0.01;
    const drawing = await page.evaluate(
      ({ center, half }) =>
        window.__glassmapStore!.getState().addDrawing({
          source: "user",
          kind: "polygon",
          label: "hand-drawn block",
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

    await page.locator(`[data-testid="zoom-to-drawing"][data-drawing-id="${drawing.id}"]`).click();

    await expect
      .poll(async () => (await callTool(page, "get_map_state")).bounds)
      .not.toBeNull();
    const state = await callTool(page, "get_map_state");
    expect(state.bounds!.west).toBeLessThanOrEqual(CENTER.lng - HALF);
    expect(state.bounds!.south).toBeLessThanOrEqual(CENTER.lat - HALF);
    expect(state.bounds!.east).toBeGreaterThanOrEqual(CENTER.lng + HALF);
    expect(state.bounds!.north).toBeGreaterThanOrEqual(CENTER.lat + HALF);
    // Containment alone is satisfiable by a camera that never moved: the
    // fixture square sits inside the DEFAULT_VIEW corridor at z12. The frame
    // must actually travel — centre on the square and come CLOSER, which is
    // the "answers 'show me this' with a dot" regression frame-model.test.ts
    // names (T-101 final review, SF2).
    expect(state.center).toEqual({ lng: CENTER.lng, lat: CENTER.lat });
    expect(state.zoom!).toBeGreaterThan(12);
  });

  test("a pinned note's row flies to its exact coordinate, and the point rule never drops a zoom already past its floor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);

    // Zoomed in well past ROW_POINT_ZOOM (15) and looking at somewhere else
    // entirely, so "the camera did not move at all" cannot masquerade as
    // "the point rule left the zoom alone".
    const start = await callTool(page, "set_map_view", { center: { lng: 121.55, lat: 25.06 }, zoom: 18 });
    expect(start.error).toBeUndefined();
    expect(await waitForAwake(page, 2500)).toBe("awake");

    const AT = { lng: 121.503, lat: 25.028 };
    const annotation = await page.evaluate(
      (at) =>
        window.__glassmapStore!.getState().addAnnotation({
          source: "user",
          at: [at.lng, at.lat],
          note: "quiet street, good light",
        }),
      AT,
    );
    await expect(page.getByTestId("annotation-count")).toHaveText("1");

    await page.locator(`[data-testid="zoom-to-annotation"][data-annotation-id="${annotation.id}"]`).click();

    const state = await callTool(page, "get_map_state");
    expect(state.center).toEqual(AT);
    // Never zoom out: a floor, not a target -- 18 was already past it.
    expect(state.zoom).toBe(18);
  });

  test("an id nothing has loaded renders with no zoom button and only its own ✕, which removes it without disturbing the rest of the selection", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);
    await wakeChrome(page);

    // A share link naming an id that never arrived, or one that never
    // existed at all: `resolveSelection` keeps it as a row rather than
    // dropping it silently (selection-model.ts), written straight onto the
    // store the way `remove-from-map.spec.ts` writes fixtures with no
    // scripted mouse path across a real map.
    const bogusId = "osm:node:not-a-real-e2e-id";
    await page.evaluate(
      ({ real, bogus }) =>
        window.__glassmapStore!.getState().setSelection([real, bogus], { [real]: "agent", [bogus]: "agent" }),
      { real: DAAN_STATION.id, bogus: bogusId },
    );
    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("2");

    const bogusRow = page.locator(`li[data-feature-id="${bogusId}"]`);
    await expect(bogusRow).toHaveAttribute("data-zoomable", "false");
    await expect(bogusRow.locator('[data-testid="zoom-to-feature"]')).toHaveCount(0);
    await expect(bogusRow.locator('[data-testid="deselect-feature"]')).toHaveCount(1);

    await bogusRow.locator('[data-testid="deselect-feature"]').click();

    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("1");
    const state = await callTool(page, "get_map_state");
    expect(state.selection).toEqual({ count: 1, ids: [DAAN_STATION.id] });
    const sources = await page.evaluate(() => window.__glassmapStore!.getState().selectionSources);
    expect(sources).toEqual({ [DAAN_STATION.id]: "agent" });
  });

  test("Enter on a focused zoom-to-feature row moves the camera exactly like a click, and adds no activity row", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);

    const selected = await callTool(page, "select_features", { ids: [DAAN_STATION.id] });
    expect(selected.error).toBeUndefined();
    expect(await waitForAwake(page, 2500)).toBe("awake");
    await expect(page.getByTestId("sidebar-selection-count")).toHaveText("1");

    const activityBefore = await page.evaluate(() => window.__glassmapStore!.getState().activity.length);

    // A real <button>, so Enter has to work with no keydown handler of the
    // row's own (Inspector.tsx's own comment): default view is zoom 12,
    // Daan Station is at [121.54355, 25.03333] -- a keyboard activation that
    // did nothing would leave both exactly where they started.
    const row = page.locator(`[data-testid="zoom-to-feature"][data-feature-id="${DAAN_STATION.id}"]`);
    await row.focus();
    await row.press("Enter");

    // Read off the store, and before any `callTool` below, for the same
    // reason the district-✕ test does: `get_map_state` is itself a tracked
    // tool call (`withActivity` wraps every tool, read-only ones included),
    // so calling it first would add a row and invalidate this assertion.
    expect(await page.evaluate(() => window.__glassmapStore!.getState().activity.length)).toBe(
      activityBefore,
    );

    const state = await callTool(page, "get_map_state");
    expect(state.center).toEqual({ lng: DAAN_STATION.lng, lat: DAAN_STATION.lat });
    expect(state.zoom).toBe(15);
  });
});
