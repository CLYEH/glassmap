/**
 * T-94 -- `plan_route`: the one tool that asks somebody else's server a
 * question, end to end.
 *
 * `src/lib/map-tools/route.test.ts` already proves the whole engine against an
 * injected `routeFetch` -- parsing, simplification, the rate limiter, every
 * refusal wording -- with no DOM. What this file adds is the part that suite
 * cannot see: a real page, tool calls through `document.modelContext` the way
 * a WebMCP client makes them, and the surfaces a person actually watches (the
 * map's own drawing count, the activity feed's row text, the routing
 * attribution) agreeing with what the JSON says.
 *
 * This suite is network-isolated by default (`fixtures.ts`), which is exactly
 * what makes the *unmocked* path worth a test of its own: a call to
 * `routing.openstreetmap.de` is aborted before it ever reaches a real server,
 * so "the service could not be reached" is not a simulation here -- it is the
 * suite's own network block, exercised the honest way. The *mocked* path
 * needs `page.route()` to answer for that host instead, which takes
 * precedence over the block (Playwright's own rule) but still fires
 * `requestfinished` for a request that never really left the browser -- see
 * `mockExternalHost` in `fixtures.ts` for why that needs an explicit opt-in
 * rather than silently passing.
 *
 * One case this file deliberately does NOT attempt: the FX degrade for "a
 * successful plan_route whose drawing is not in the store" (plan.ts's
 * `plan_route` branch, `{kind: "none"}`). Every real success path adds the
 * drawing before the tool call resolves, so reaching that branch here would
 * mean racing a second call against this file's own effect layer with no
 * clock to synchronise on -- not an adversarial *input*, just a flake
 * generator. `src/components/fx/plan.test.ts` ("degrades to a feed-row glow
 * when the line is not in the store") already proves the decision as a pure
 * function of a store snapshot, which is the correct level for it.
 */
import type { Page } from "@playwright/test";
import type { Position } from "geojson";
import { ROUTE_ATTRIBUTION, ROUTE_SERVICE_URL, routeUrl } from "@/lib/map-tools/route";
import type { LngLat } from "@/lib/store/map-store";
import { callTool } from "./mcp";
import { expect, mockExternalHost, test } from "./fixtures";
import { waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";

/**
 * The two ends this file plans every walk between: real entries from
 * `public/data/mrt-stations.geojson`, not invented. Verified against the full
 * 2,063-feature bundled dataset (every `public/data/*.geojson` merged, the
 * same set `resolvePlaceOne` searches) to resolve uniquely for "Daan Station"
 * / "Taipei Main Station" with no ambiguous second candidate -- 大安 station
 * itself outscores every other place whose name merely starts with "daan"
 * (a district, a park) or contains "station".
 */
const DAAN: LngLat = [121.54355, 25.03333];
const TAIPEI_MAIN: LngLat = [121.51591, 25.04747];

const ROUTE_HOST = "routing.openstreetmap.de";
const ROUTE_PATTERN = "**/routing.openstreetmap.de/**";

/**
 * A walking line between two points, long enough (180 points) to match what
 * the live service actually answers for a real Taipei walk this size
 * (`route.test.ts`'s own comment: "181 points is what the live service
 * answered for a 3.8 km Taipei walk") without tripping `MAX_SHAPE_POINTS`
 * (500) -- so a plan_route call in this file never simplifies unless a test
 * asks it to.
 */
function walkingLine(from: LngLat, to: LngLat, points = 180): Position[] {
  const interior = Array.from({ length: points - 2 }, (_, i) => {
    const t = (i + 1) / (points - 1);
    const wobble = Math.sin(i / 5) * 0.0004;
    return [from[0] + (to[0] - from[0]) * t + wobble, from[1] + (to[1] - from[1]) * t] as Position;
  });
  return [from, ...interior, to];
}

/** The OSRM-shaped body a real `routed-foot` deployment answers with. */
function routeFixtureBody(from: LngLat, to: LngLat) {
  return {
    code: "Ok",
    routes: [
      {
        distance: 3830,
        duration: 3064,
        geometry: { type: "LineString", coordinates: walkingLine(from, to) },
      },
    ],
  };
}

/**
 * Arms the mock and returns the URLs it actually intercepted, in call order.
 * Must run before the triggering `plan_route` call. Registers the host with
 * `mockedExternalHosts` first -- see `fixtures.ts` for why an un-registered
 * mock would fail the suite's own leak check instead of this test's own
 * assertions.
 */
async function mockRouteSuccess(
  page: Page,
  mockedExternalHosts: Set<string>,
  from: LngLat,
  to: LngLat,
): Promise<string[]> {
  mockExternalHost(mockedExternalHosts, ROUTE_HOST);
  const urls: string[] = [];
  await page.route(ROUTE_PATTERN, (route) => {
    urls.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(routeFixtureBody(from, to)),
    });
  });
  return urls;
}

async function goReady(page: Page): Promise<void> {
  await page.goto("/");
  await waitForTools(page);
  await waitForFeatures(page);
}

test.describe("plan_route (T-94)", () => {
  test("mocked success: draws the walk, updates the counts and the feed, and credits FOSSGIS", async ({
    page,
    mockedExternalHosts,
  }) => {
    await goReady(page);
    await mockRouteSuccess(page, mockedExternalHosts, DAAN, TAIPEI_MAIN);

    // No credit owed yet: nothing has asked the routing service anything.
    await expect(page.getByTestId("route-attribution")).toHaveCount(0);

    const out = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });

    expect(out.error).toBeUndefined();
    expect(out.drawing_id).toBeTruthy();
    expect(out.distance_m).toBe(3830);
    expect(out.duration_s).toBe(3064);
    expect(out.points).toBe(180);
    expect(out.simplified).toBeUndefined();
    expect(out.attribution).toBe(ROUTE_ATTRIBUTION);
    expect(out.state?.drawings.count).toBe(1);

    // The map agrees, not just the tool's own echo of what it just did.
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    // The feed row a human reads.
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.awaken), { timeout: 2500 })
      .toBe("awake");
    const row = page.locator('[data-testid="activity-call"][data-tool="plan_route"]').last();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Planned a walk");
    await expect(row).not.toContainText("Refused —");

    // The routing credit: exact words, latched on now that a route has really
    // been planned, and above the basemap's own attribution in the DOM (the
    // same order `Attribution.tsx` renders them in).
    const credit = page.getByTestId("route-attribution");
    await expect(credit).toHaveText(ROUTE_ATTRIBUTION);
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="route-attribution"], [data-testid="attribution"]')).map(
        (el) => el.getAttribute("data-testid"),
      ),
    );
    expect(order).toEqual(["route-attribution", "attribution"]);
  });

  test("chaining: the planned route works with measure and remove_from_map, and the credit survives removal", async ({
    page,
    mockedExternalHosts,
  }) => {
    await goReady(page);
    await mockRouteSuccess(page, mockedExternalHosts, DAAN, TAIPEI_MAIN);

    const planned = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });
    expect(planned.error).toBeUndefined();
    const drawingId = planned.drawing_id as string;

    const measured = await callTool(page, "measure", { target: drawingId });
    expect(measured.error).toBeUndefined();
    expect(measured.length_m).toBeGreaterThan(0);

    await expect(page.getByTestId("route-attribution")).toHaveCount(1);

    const removed = await callTool(page, "remove_from_map", { ids: [drawingId] });
    expect(removed.removed_count).toBe(1);
    await expect(page.getByTestId("drawing-count")).toHaveText("0");
    expect(await page.evaluate(() => window.__glassmapStore!.getState().drawings)).toEqual([]);

    // Gone from the map; the layer, and the map, agree on that (T-90's own
    // contract). The credit is a different promise -- it is about a request
    // that was made, not about what still shows -- and `remove_from_map` did
    // not take that back.
    const credit = page.getByTestId("route-attribution");
    await expect(credit).toHaveCount(1);
    await expect(credit).toHaveText(ROUTE_ATTRIBUTION);
  });

  test("resolve-by-name: station names from the bundled data resolve to the coordinates the request actually carries", async ({
    page,
    mockedExternalHosts,
  }) => {
    await goReady(page);
    const urls = await mockRouteSuccess(page, mockedExternalHosts, DAAN, TAIPEI_MAIN);

    const out = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });

    expect(out.error).toBeUndefined();
    // The tool's own echo of what it resolved each name to -- an agent that
    // only typed a name has no other way to check this.
    expect(out.from).toEqual({ lng: DAAN[0], lat: DAAN[1], name: "大安" });
    expect(out.to).toEqual({ lng: TAIPEI_MAIN[0], lat: TAIPEI_MAIN[1], name: "台北車站" });

    // The one thing route interception can prove that the tool's own answer
    // cannot: the URL that actually left the page carried those coordinates,
    // not the names, and it is a walking (routed-foot) request.
    expect(urls).toEqual([routeUrl(DAAN, TAIPEI_MAIN)]);
    expect(urls[0]).toContain("routed-foot");
    expect(urls[0]).toContain(`${DAAN[0]},${DAAN[1]}`);
    expect(urls[0]).toContain(`${TAIPEI_MAIN[0]},${TAIPEI_MAIN[1]}`);
  });

  test("service failure: an unmocked call is honestly refused and leaves the map untouched", async ({
    page,
    blockedRequests,
  }) => {
    await goReady(page);

    const before = await page.evaluate(() => window.__glassmapStore?.getState().drawings.length ?? 0);

    const out = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });

    expect(out.error).toBeTruthy();
    expect(out.error).toMatch(/routing service could not be reached/);
    expect(out.error).toMatch(/map is unchanged/);
    expect(out.drawing_id).toBeUndefined();
    expect(out.state?.drawings).toEqual({ count: before, items: [] });

    // Proof this was a genuine, blocked attempt -- not a call that never left
    // the tool layer -- the same positive check network-isolation.spec.ts
    // makes for the basemap CDN.
    await expect
      .poll(() => blockedRequests, {
        message: "plan_route should have attempted -- and been blocked from completing -- a request to the routing service",
      })
      .toEqual(expect.arrayContaining([expect.stringContaining(ROUTE_SERVICE_URL)]));

    await expect(page.getByTestId("drawing-count")).toHaveText(String(before));
    await expect(page.getByTestId("route-attribution")).toHaveCount(0);

    await expect
      .poll(() => page.evaluate(() => document.body.dataset.awaken), { timeout: 2500 })
      .toBe("awake");
    const row = page.locator('[data-testid="activity-call"][data-tool="plan_route"]').last();
    await expect(row).toContainText("Refused —");
  });
});

// ------------------------------------------------------------------------ fx
// Reimplements remove-from-map.spec.ts's own browser-clock MutationObserver
// idiom (duplicated there from fx.spec.ts's private version, for the same
// reason: a Node-side poll of `data-fx-*` has its own IPC round trip inside
// the ~1.6s window this file measures, which is exactly the race that
// idiom's own comments record having produced a false failure before).
interface FxClockState {
  startedAt?: number;
  startedPlaying?: string;
  nodeSeenAtStart?: boolean;
  clearedAt?: number;
  viewportChildren?: number;
  overlayChildren?: number;
}

interface FxCycle {
  lifetimeMs: number | null;
  startedPlaying: string | null;
  nodeSeenAtStart: boolean;
  viewportChildren: number | null;
  overlayChildren: number | null;
}

async function armFxClock(page: Page, effectName: string): Promise<void> {
  await page.evaluate((effectName) => {
    const w = window as unknown as { __planRouteFxClock?: FxClockState; __planRouteFxObserver?: MutationObserver };
    w.__planRouteFxObserver?.disconnect();
    w.__planRouteFxClock = {};
    const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
    const overlay = document.querySelector<HTMLElement>('[data-testid="fx-overlay"]');
    if (!viewport) return;
    const observer = new MutationObserver(() => {
      const clock = w.__planRouteFxClock!;
      const count = viewport.dataset.fxCount ?? "0";
      if (count !== "0" && clock.startedAt === undefined) {
        clock.startedAt = performance.now();
        clock.startedPlaying = viewport.dataset.fxPlaying ?? "";
        clock.nodeSeenAtStart =
          document.querySelectorAll(`[data-testid="fx-effect"][data-fx-name="${effectName}"]`).length > 0;
      } else if (count === "0" && clock.startedAt !== undefined && clock.clearedAt === undefined) {
        clock.clearedAt = performance.now();
        clock.viewportChildren = viewport.childElementCount;
        clock.overlayChildren = overlay?.childElementCount ?? -1;
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ["data-fx-count"] });
    w.__planRouteFxObserver = observer;
  }, effectName);
}

async function waitForFxCycle(page: Page, timeoutMs: number): Promise<FxCycle> {
  return page.evaluate((timeoutMs) => {
    return new Promise<FxCycle>((resolve) => {
      const w = window as unknown as { __planRouteFxClock?: FxClockState };
      const deadline = performance.now() + timeoutMs;
      const check = () => {
        const clock = w.__planRouteFxClock;
        if (clock?.startedAt !== undefined && clock.clearedAt !== undefined) {
          resolve({
            lifetimeMs: clock.clearedAt - clock.startedAt,
            startedPlaying: clock.startedPlaying ?? null,
            nodeSeenAtStart: clock.nodeSeenAtStart ?? false,
            viewportChildren: clock.viewportChildren ?? null,
            overlayChildren: clock.overlayChildren ?? null,
          });
        } else if (performance.now() >= deadline) {
          resolve({
            lifetimeMs: null,
            startedPlaying: null,
            nodeSeenAtStart: false,
            viewportChildren: null,
            overlayChildren: null,
          });
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, timeoutMs);
}

test.describe("plan_route FX (T-94)", () => {
  test("plays the route ink once (~1.6s) and clears to zero residue", async ({ page, mockedExternalHosts }) => {
    await goReady(page);
    await waitForLiveMap(page);
    await mockRouteSuccess(page, mockedExternalHosts, DAAN, TAIPEI_MAIN);

    await armFxClock(page, "plan_route");
    const out = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });
    expect(out.error).toBeUndefined();

    const cycle = await waitForFxCycle(page, 3000);

    expect(cycle.startedPlaying, JSON.stringify(cycle)).toBe("plan_route");
    // The real route ink, not the geometry-less glow-only fallback: the
    // drawing landed in the store before the tool call returned, so the
    // effect had a line to draw for this call.
    expect(cycle.nodeSeenAtStart).toBe(true);
    expect(cycle.lifetimeMs, JSON.stringify(cycle)).not.toBeNull();
    // routeInk's own duration (effects.ts) is 1600ms; generous headroom for
    // CI scheduling jitter without hiding an effect that never clears.
    expect(cycle.lifetimeMs).toBeLessThanOrEqual(2600);
    expect(cycle.viewportChildren).toBe(0);
    expect(cycle.overlayChildren).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });

  test("?fx=off: plan_route never spawns a single fx-effect node", async ({ page, mockedExternalHosts }) => {
    await page.goto("/?fx=off");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await mockRouteSuccess(page, mockedExternalHosts, DAAN, TAIPEI_MAIN);

    await expect(page.locator("body")).toHaveAttribute("data-fx", "off");

    const out = await callTool(page, "plan_route", { from: "Daan Station", to: "Taipei Main Station" });
    expect(out.error).toBeUndefined();

    const viewport = page.getByTestId("fx-viewport");
    const overlay = page.getByTestId("fx-overlay");
    await expect(viewport).toHaveAttribute("data-fx-count", "0");
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
    expect(await overlay.evaluate((el) => el.childElementCount)).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });
});
