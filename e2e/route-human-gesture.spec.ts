/**
 * T-110 -- a person plans a walking route by hand: click where it starts,
 * click where it ends, and the Route pill draws it the same way `plan_route`
 * does, but as `source: "user"` and with no activity row (a hand gesture is
 * not a tool call).
 *
 * `src/components/draw-store.ts` (`addRouteVertex`, the same-point guard, the
 * planning ticket), `DrawToolbar.tsx` (`RoutePill`, `routeHint`, `DrawHint`),
 * `route-label.ts` (`routeLabel`), `route-draft-marker.ts` and the route half
 * of `MapCanvas.tsx`'s click handlers already have this file's premises spelt
 * out; nothing here mirrors their logic back at them; every expected string
 * below is either the contract's own wording or computed by hand from
 * `route-label.ts`'s documented rounding, not by importing the formatter.
 *
 * `plan-route.spec.ts` proves the agent's `plan_route` end to end and this
 * file leans on its conventions throughout (`mockExternalHost`, the OSRM
 * fixture shape, the network-isolation posture: this suite aborts every
 * non-localhost request by default, so `routing.openstreetmap.de` must be
 * registered and mocked per test that expects a real request to complete).
 * `note-human-gestures.spec.ts` is where the human-gesture conventions this
 * file follows come from: fresh page per test, `clickMapOffset`/
 * `unprojectRounded` against the map's own `unproject`, and the
 * basemap-style-mock escape hatch needed for `INTERACTIVE_LAYER_IDS` click
 * handlers to exist at all (they are only added inside MapLibre's `load`).
 */
import type { Page } from "@playwright/test";
import type { Position } from "geojson";
import type { LngLat } from "@/lib/store/map-store";
import { INTERACTIVE_LAYER_IDS } from "@/components/map-style";
import { callTool } from "./mcp";
import { expect, mockExternalHost, test } from "./fixtures";
import { waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

const ROUTE_HOST = "routing.openstreetmap.de";
const ROUTE_PATTERN = "**/routing.openstreetmap.de/**";

/** Any two valid points, unrelated to what a test actually clicked: nothing
 * in `route.ts` cross-checks the service's returned geometry against the
 * request's endpoints, so a fixed line is enough for every "success" fixture
 * below. */
const FIXTURE_LINE: Position[] = [
  [121.54355, 25.03333],
  [121.51591, 25.04747],
];

/**
 * The OSRM-shaped success body this file draws its walk from throughout.
 * distance/duration are chosen, not arbitrary: `routeLabel(1234, 754)` is
 * "walking route · 1.2 km · 13 min" by `route-label.ts`'s own documented
 * rules (1234 m -> 1.234 km, one decimal since < 10 km; 754 s -> ceil(754/60)
 * = 13 min, never rounded down) -- computed here by hand, not by calling the
 * formatter, so a change to either rule breaks this file's own expectation
 * rather than silently agreeing with whatever the code now does.
 */
const FIXTURE_DISTANCE_M = 1234;
const FIXTURE_DURATION_S = 754;
const EXPECTED_ROUTE_LABEL = "walking route · 1.2 km · 13 min";
const ROUTE_ATTRIBUTION_TEXT =
  "Walking route by the FOSSGIS OSRM service, data © OpenStreetMap contributors";

function routeSuccessBody(distance = FIXTURE_DISTANCE_M, duration = FIXTURE_DURATION_S) {
  return {
    code: "Ok",
    routes: [
      {
        distance,
        duration,
        geometry: { type: "LineString", coordinates: FIXTURE_LINE },
      },
    ],
  };
}

async function goReady(page: Page): Promise<void> {
  await page.goto("/?shim=1");
  await waitForTools(page);
  await waitForFeatures(page);
  await waitForLiveMap(page);
  await waitForStoreHandle(page);
}

/** The map container's own box -- full-bleed (globals.css: `.map-wrap { inset: 0 }`). */
async function mapBox(page: Page) {
  const box = await page.getByTestId("map").boundingBox();
  if (!box) throw new Error("map container has no box");
  return box;
}

/** Clicks `(dx, dy)` away from the map's own centre and returns the page-space pixel clicked. */
async function clickMapOffset(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  const box = await mapBox(page);
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.click(x, y);
  return { x, y };
}

/** What the click at `(x, y)` really unprojects to, rounded the same way `draw-store.ts`'s
 * `roundVertex` rounds a clicked point -- the independent half of the "the request carries
 * what was actually clicked" proof. */
async function unprojectRounded(page: Page, x: number, y: number): Promise<LngLat> {
  return page.evaluate(
    ({ x, y }) => {
      const { lng, lat } = window.__glassmapMap!.unproject([x, y]);
      const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
      return [round5(lng), round5(lat)] as LngLat;
    },
    { x, y },
  );
}

async function startRouteMode(page: Page): Promise<void> {
  await page.getByTestId("route-toggle").click();
  await expect(page.getByTestId("route-toggle")).toHaveAttribute("aria-pressed", "true");
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("T-110 -- a person plans a walk by clicking two points", () => {
  test("happy path: two clicks plan and draw the walk, with no activity row -- and the agent's own plan_route stays untouched", async ({
    page,
    mockedExternalHosts,
  }) => {
    test.setTimeout(45_000);
    await goReady(page);

    mockExternalHost(mockedExternalHosts, ROUTE_HOST);
    const urls: string[] = [];
    let releasePlanning: () => void = () => {};
    const planningGate = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    await page.route(ROUTE_PATTERN, async (route) => {
      urls.push(route.request().url());
      await planningGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(routeSuccessBody()),
      });
    });

    await startRouteMode(page);
    await expect(page.getByTestId("route-toggle").locator(".lbl")).toHaveText("Cancel");
    await expect(page.getByTestId("draw-mode")).toHaveText("route");
    const hint = page.getByTestId("draw-hint");
    await expect(hint).toHaveAttribute("data-mode", "route");
    await expect(hint).toHaveText("Click where the walk starts. Esc to cancel.");

    // Well clear of the tools row (top:14/right:14) and the search box
    // (top:62/left:14/width:302) at this viewport, and far enough apart from
    // each other that neither click could round to the other by accident.
    const start = await clickMapOffset(page, 220, 90);
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(1);
    await expect(hint).toHaveText("Click where it ends.");

    const end = await clickMapOffset(page, -220, -90);
    // Caught mid-flight, before the delayed fixture answers.
    await expect(hint).toHaveText("Planning the walk…");

    expect(urls).toHaveLength(1);
    const fromPoint = await unprojectRounded(page, start.x, start.y);
    const toPoint = await unprojectRounded(page, end.x, end.y);
    expect(urls[0]).toContain(`${fromPoint[0]},${fromPoint[1]}`);
    expect(urls[0]).toContain(`${toPoint[0]},${toPoint[1]}`);

    releasePlanning();

    await expect(page.getByTestId("draw-hint")).toHaveCount(0);
    await expect(page.getByTestId("draw-mode")).toHaveText("off");
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(0);
    // A second click while planning would have spent the next second's
    // request or been dropped by the store -- either way, still exactly one.
    expect(urls).toHaveLength(1);

    await expect(page.getByTestId("route-attribution")).toHaveText(ROUTE_ATTRIBUTION_TEXT);
    // A hand-planned walk is not a tool call: nothing in the feed yet -- checked
    // before any tool below runs (get_map_state/measure/plan_route each log
    // their own row; every one of those would land here too, since the
    // selector below is untargeted).
    await expect(page.locator('[data-testid="activity-call"]')).toHaveCount(0);

    const state = await callTool(page, "get_map_state");
    expect(state.error).toBeUndefined();
    expect(state.drawings?.count).toBe(1);
    expect(state.drawings?.items[0]).toMatchObject({
      source: "user",
      kind: "line",
      label: EXPECTED_ROUTE_LABEL,
    });

    const measured = await callTool(page, "measure", { target: "drawing:1" });
    expect(measured.error).toBeUndefined();
    expect(measured.length_m).toBeGreaterThan(0);

    // --- Agent tool untouched (T-110's other half) ------------------------
    const planned = await callTool(page, "plan_route", { from: "Daan Station", to: "Daan Forest Park" });
    expect(planned.error).toBeUndefined();
    expect(planned.drawing_id).toBe("drawing:2");

    const drawings = await page.evaluate(() => window.__glassmapStore!.getState().drawings);
    expect(drawings).toHaveLength(2);
    expect(drawings[0]).toMatchObject({ id: "drawing:1", source: "user" });
    expect(drawings[1]).toMatchObject({ id: "drawing:2", source: "agent" });
    await expect(
      page.locator('[data-testid="activity-call"][data-tool="plan_route"]'),
    ).toHaveCount(1);

    // remove_from_map refuses the human's own line, and it survives.
    const removed = await callTool(page, "remove_from_map", { ids: ["drawing:1"] });
    expect(removed.error).toBeUndefined();
    expect(removed.removed).toEqual([]);
    expect(removed.refused).toEqual([{ id: "drawing:1", kind: "drawing", source: "user" }]);
    const survivingIds = await page.evaluate(() =>
      window.__glassmapStore!.getState().drawings.map((d) => d.id),
    );
    expect(survivingIds).toContain("drawing:1");
  });

  test("refusal: the service's own sentence is shown verbatim, nothing is drawn, and a retry is possible", async ({
    page,
    mockedExternalHosts,
  }) => {
    await goReady(page);

    mockExternalHost(mockedExternalHosts, ROUTE_HOST);
    const urls: string[] = [];
    await page.route(ROUTE_PATTERN, (route) => {
      urls.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: "NoRoute" }),
      });
    });

    await startRouteMode(page);
    await clickMapOffset(page, 220, 90);
    await clickMapOffset(page, -220, -90);

    const hint = page.getByTestId("draw-hint");
    await expect(hint).toHaveText(
      "the routing service could not plan this walk: there is no walking route between " +
        "these two points. Nothing was drawn and the map is unchanged. Click a new start, or Esc.",
    );
    expect(urls).toHaveLength(1);

    const state = await callTool(page, "get_map_state");
    expect(state.error).toBeUndefined();
    expect(state.drawings?.count).toBe(0);
    await expect(page.getByTestId("draw-mode")).toHaveText("route");
    await expect(page.getByTestId("route-attribution")).toHaveCount(0);

    // The person can retry: a new pair of clicks makes a second request.
    await clickMapOffset(page, 220, 90);
    await clickMapOffset(page, -220, -90);
    await expect.poll(() => urls.length).toBe(2);
  });

  test("same point twice: no request, the start survives, and the hint says what is still missing", async ({
    page,
    blockedRequests,
  }) => {
    await goReady(page);
    await startRouteMode(page);

    const start = await clickMapOffset(page, 220, 90);
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(1);
    await page.mouse.click(start.x, start.y);

    await expect(page.getByTestId("draw-hint")).toHaveText(
      "That is where the walk starts. Click where it ends.",
    );
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(1);
    await expect(page.getByTestId("draw-mode")).toHaveText("route");
    expect(blockedRequests.filter((u) => u.includes(ROUTE_HOST))).toEqual([]);
  });

  test("Escape after one click cancels immediately, with no request ever made", async ({
    page,
    blockedRequests,
  }) => {
    await goReady(page);
    await startRouteMode(page);
    await clickMapOffset(page, 220, 90);
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(1);

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("draw-mode")).toHaveText("off");
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("draw-hint")).toHaveCount(0);
    expect(blockedRequests.filter((u) => u.includes(ROUTE_HOST))).toEqual([]);
  });

  test("Escape while planning discards the answer -- the line never appears, even once the fixture resolves", async ({
    page,
    mockedExternalHosts,
  }) => {
    await goReady(page);

    mockExternalHost(mockedExternalHosts, ROUTE_HOST);
    let releasePlanning: () => void = () => {};
    const planningGate = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    await page.route(ROUTE_PATTERN, async (route) => {
      await planningGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(routeSuccessBody()),
      });
    });

    await startRouteMode(page);
    await clickMapOffset(page, 220, 90);
    await clickMapOffset(page, -220, -90);
    await expect(page.getByTestId("draw-hint")).toHaveText("Planning the walk…");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("draw-mode")).toHaveText("off");
    await expect(page.getByTestId("draw-hint")).toHaveCount(0);

    releasePlanning();
    // Give the now-answered (but invalidated) fetch a real chance to land.
    await page.waitForTimeout(500);

    const state = await callTool(page, "get_map_state");
    expect(state.error).toBeUndefined();
    expect(state.drawings?.count).toBe(0);
    await expect(page.getByTestId("route-attribution")).toHaveCount(0);
  });

  test("a click on a selected bundled feature is suppressed as a card and counted as the route's start", async ({
    page,
    mockedExternalHosts,
  }) => {
    test.setTimeout(60_000);
    // The bundled data layers' click handlers are only added inside MapLibre's
    // `load`, which never fires under this suite's default network isolation
    // (the real basemap CDN is blocked). A minimal-but-valid style response
    // for that same blocked host is enough for `load` to fire without leaking
    // a real network call -- the same escape hatch `note-human-gestures.spec.ts`
    // and `place-details.spec.ts` already established for exactly this gap.
    const BASEMAP_HOST = "tiles.openfreemap.org";
    mockExternalHost(mockedExternalHosts, BASEMAP_HOST);
    await page.route(`**/${BASEMAP_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      }),
    );
    await goReady(page);
    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });

    // Da'an MRT station: bundled base data, loaded from the moment the page's
    // datasets arrive, never through tier-2.
    const STATION = { id: "osm:node:3494960748", lng: 121.54355, lat: 25.03333 };
    const selected = await callTool(page, "select_features", { ids: [STATION.id] });
    expect(selected.error).toBeUndefined();
    const view = await callTool(page, "set_map_view", { center: { lng: STATION.lng, lat: STATION.lat }, zoom: 15 });
    expect(view.error).toBeUndefined();

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__glassmapMap!;
          const timer = setTimeout(resolve, 8000);
          map.once("idle", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    );

    const stationPixel = await page.evaluate(
      ({ id, layers }) => {
        const map = window.__glassmapMap!;
        const match = map
          .queryRenderedFeatures({ layers })
          .find((f) => (f.properties as { id?: string })?.id === id && f.geometry.type === "Point");
        if (!match || match.geometry.type !== "Point") return null;
        const projected = map.project(match.geometry.coordinates as [number, number]);
        const hit = map.queryRenderedFeatures([projected.x, projected.y], { layers });
        return hit.some((f) => (f.properties as { id?: string })?.id === id)
          ? { x: projected.x, y: projected.y }
          : null;
      },
      { id: STATION.id, layers: [...INTERACTIVE_LAYER_IDS] },
    );
    if (!stationPixel) {
      throw new Error(`${STATION.id} was not hit-testable at INTERACTIVE_LAYER_IDS after set_map_view zoom 15`);
    }

    // Closed route mode: the ordinary tap answers "what is this?" -- proof
    // the station really is clickable at this pixel before route mode hides it.
    await page.mouse.click(stationPixel.x, stationPixel.y);
    const card = page.getByTestId("on-the-map-card");
    await expect(card).toHaveCount(1);
    await page.getByTestId("otm-close").click();
    await expect(card).toHaveCount(0);

    await startRouteMode(page);
    await page.mouse.click(stationPixel.x, stationPixel.y);
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("route-draft-pin")).toHaveCount(1);
    await expect(page.getByTestId("draw-hint")).toHaveText("Click where it ends.");
  });

  test("phone tier (390x844): the route hint is exempted from the polygon hint's hiding, and clears the search box and tools row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goReady(page);

    await startRouteMode(page);
    const hint = page.getByTestId("draw-hint");
    await expect(hint).toBeVisible();

    const hintBox = await hint.boundingBox();
    const searchBox = await page.getByTestId("search-box").boundingBox();
    const toolsBox = await page.getByTestId("tools").boundingBox();
    if (!hintBox || !searchBox || !toolsBox) {
      throw new Error("draw-hint, search-box or tools has no box at the phone tier");
    }
    expect(rectsOverlap(hintBox, searchBox)).toBe(false);
    expect(rectsOverlap(hintBox, toolsBox)).toBe(false);
  });
});
