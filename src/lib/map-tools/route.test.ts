/**
 * plan_route — the one tool that asks a server a question at request time.
 *
 * Everything here is about what that costs. A route comes from somebody else's
 * service, so it can be slow, wrong or absent; the map must never show a walk
 * that was not planned, the agent must always be told plainly when there is
 * none, and FOSSGIS' one-request-per-second policy has to hold even when three
 * calls arrive at once. What does land on the map is an ordinary agent
 * drawing: the human can see it, `measure` can size it and `remove_from_map`
 * can take it back.
 *
 * No test in this file touches the network — the service is injected.
 */
import { describe, expect, it, vi } from "vitest";
import type { Position } from "geojson";
import { createMapTools } from "./index";
import {
  createMemoryToolStore,
  type MapToolStore,
  type MemoryToolStoreInit,
} from "@/lib/store/map-store";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { MapStateOutput } from "./state";
import { MAX_LABEL_CHARS, MAX_SHAPE_POINTS } from "./shapes";
import {
  DEFAULT_ROUTE_LABEL,
  ROUTE_ATTRIBUTION,
  ROUTE_MAX_WAIT_MS,
  ROUTE_MIN_INTERVAL_MS,
  ROUTE_SERVICE_URL,
  ROUTE_TIMEOUT_MS,
  decimateRoutePoints,
  resetRouteThrottle,
  type RouteFetch,
} from "./route";
import {
  DAAN_STATION,
  FIXTURE_FEATURES,
  ROUTE_FIXTURE_BEND,
  ROUTE_FIXTURE_DISTANCE,
  ROUTE_FIXTURE_DURATION,
  TAIPEI_MAIN_STATION,
  VIEW,
  VIEW_BOUNDS,
  createRouteFetch,
  routeOkBody,
  routeRequestPoints,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  field?: string;
  candidates?: { id: string }[];
  drawing_id?: string;
  label?: string;
  distance_m?: number;
  duration_s?: number;
  points?: number;
  simplified?: boolean;
  attribution?: string;
  from?: { lng: number; lat: number; name?: string };
  to?: { lng: number; lat: number; name?: string };
  length_m?: number;
  removed_count?: number;
  state?: MapStateOutput;
}

type Answer = (from: Position, to: Position) => unknown;

function mapReady(answer?: Answer, over: MemoryToolStoreInit = {}) {
  const { routeFetch, requests } = createRouteFetch(answer);
  const store: MapToolStore = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    ...over,
  });
  // The rate limiter is module state, shared by every tools instance on the
  // page — which is the point of it. Tests start from a clean second so the
  // suite is not paced by FOSSGIS' policy.
  resetRouteThrottle();
  const byName = Object.fromEntries(createMapTools(store, { routeFetch }).map((t) => [t.name, t]));
  return { store, byName, requests };
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const storedLine = (store: MapToolStore) =>
  (store.getDrawings()[0].geometry as { coordinates: Position[] }).coordinates;

const DAAN = (DAAN_STATION.geometry as { coordinates: Position }).coordinates;
const MAIN = (TAIPEI_MAIN_STATION.geometry as { coordinates: Position }).coordinates;

describe("plan_route: the two ends", () => {
  it("sends the coordinates it resolved, to the walking profile", async () => {
    // The service only knows coordinates, so a name has to be resolved by the
    // same lookup every other tool uses before anything is asked. The whole URL
    // is asserted because every part of it is load-bearing: routed-foot is what
    // makes this a walk rather than a drive, and geometries=geojson is what
    // makes the answer a line this map can draw without a polyline decoder.
    const { byName, requests } = mapReady();
    const out = await call(byName.plan_route, { from: "Daan Station", to: "Taipei Main Station" });

    expect(out.error).toBeUndefined();
    expect(requests).toEqual([
      `${ROUTE_SERVICE_URL}/121.5436,25.0334;121.517,25.0478` +
        "?overview=full&geometries=geojson&steps=false",
    ]);
  });

  it("takes a feature id at one end and a bare coordinate at the other", async () => {
    // The three forms every location parameter accepts, so a route can be
    // planned straight from a search result without a round trip through names.
    const { byName, requests } = mapReady();
    const out = await call(byName.plan_route, {
      from: "osm:way:10",
      to: { lng: 121.517, lat: 25.0478 },
    });

    expect(out.error).toBeUndefined();
    // The park's centroid, exactly as draw_shape would centre a circle on it.
    expect(routeRequestPoints(requests[0])[0]).toEqual([121.53575, 25.0295]);
    expect(out.from).toEqual({ lng: 121.53575, lat: 25.0295, name: "大安森林公園" });
    expect(out.to).toEqual({ lng: 121.517, lat: 25.0478 });
  });

  it("asks which place was meant instead of guessing, and spends no request on it", async () => {
    // Guessing an end would draw a walk to the wrong branch of a chain the
    // human cannot check without reading coordinates - and it would spend one
    // of the service's seconds doing it.
    const { store, byName, requests } = mapReady();
    const out = await call(byName.plan_route, { from: "Pxmart", to: "osm:node:1" });

    expect(out.error).toBe("ambiguous place");
    expect(out.candidates?.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    expect(requests).toEqual([]);
    expect(store.getDrawings()).toEqual([]);
  });

  it("says which of the two ends it could not resolve", async () => {
    // Both errors otherwise read the same, and the agent has to know which of
    // the two names to ask the human about - the rule compare_areas set for a
    // and b.
    const { byName, requests } = mapReady();
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "Shibuya" });

    expect(out.error).toBe("unknown place");
    expect(out.field).toBe("to");
    expect(out.state).toBeDefined();
    expect(requests).toEqual([]);
  });

  it("requires both ends, because half a route is not a route", async () => {
    const { byName } = mapReady();
    const out = await call(byName.plan_route, { from: "osm:node:2" });
    expect(out.error).toMatch(/from and to/);
    expect(out.state).toBeDefined();
  });

  it("refuses a walk from a place to itself rather than asking the service for one", async () => {
    // A zero-length line is invisible on the map and still counts as a drawing:
    // the agent would report a route the human cannot see.
    const { store, byName, requests } = mapReady();
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "Daan Station" });

    expect(out.error).toMatch(/same point/);
    expect(requests).toEqual([]);
    expect(store.getDrawings()).toEqual([]);
  });
});

describe("plan_route: what lands on the map", () => {
  it("draws the route as an agent line that measure and remove_from_map both accept", async () => {
    // The point of drawing a route rather than describing it: from here on it
    // is an ordinary drawing. The human sees it, `measure` sizes it, and the
    // agent can take back what it made (T-90) - a route nobody can remove is
    // litter on a shared map.
    const { store, byName } = mapReady();
    const planned = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(store.getDrawings()).toHaveLength(1);
    expect(store.getDrawings()[0]).toMatchObject({
      id: planned.drawing_id,
      source: "agent",
      kind: "line",
    });

    const measured = await call(byName.measure, { target: planned.drawing_id });
    expect(measured.error).toBeUndefined();
    expect(measured.length_m).toBeGreaterThan(0);

    const removed = await call(byName.remove_from_map, { ids: [planned.drawing_id] });
    expect(removed.removed_count).toBe(1);
    expect(store.getDrawings()).toEqual([]);
    expect(removed.state?.drawings).toEqual({ count: 0, items: [] });
  });

  it("rounds every point to the five decimals the rest of the layer carries", async () => {
    // The service answers at seven decimals. Storing that would make the line
    // the one thing on this map that is more precise than what the agent was
    // told - and every coordinate in a share link a little heavier.
    const { store, byName } = mapReady();
    await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(ROUTE_FIXTURE_BEND).toEqual([121.5321987, 25.0412345]);
    expect(storedLine(store)).toEqual([DAAN, [121.5322, 25.04123], MAIN]);
  });

  it("reports the service's own distance and duration, in whole units, with its attribution", async () => {
    // Measuring the drawn line ourselves and calling it the walk's distance
    // would answer a different question than the one asked - the drawn line is
    // a simplification, the service's figure is the walk. FOSSGIS asks for
    // attribution, and the agent is who reads the answer out.
    const { byName } = mapReady();
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect([ROUTE_FIXTURE_DISTANCE, ROUTE_FIXTURE_DURATION]).toEqual([3830.4, 2760.6]);
    expect(out.distance_m).toBe(3830);
    expect(out.duration_s).toBe(2761);
    expect(out.points).toBe(3);
    expect(out.simplified).toBeUndefined();
    expect(out.attribution).toBe(ROUTE_ATTRIBUTION);
  });

  it("returns the new map state, so the agent needs no follow-up read", async () => {
    const { byName } = mapReady();
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(out.state?.drawings.count).toBe(1);
    expect(out.state?.drawings.items[0]).toMatchObject({
      id: out.drawing_id,
      kind: "line",
      source: "agent",
    });
    // A line has a length and no area: that is the whole reason `within` cannot
    // take it, and map state says so on the row itself.
    expect(out.state?.drawings.items[0].length_m).toBeGreaterThan(0);
    expect(out.state?.drawings.items[0].area_m2).toBeUndefined();
  });
});

describe("plan_route: what the walk is called", () => {
  it("names the walk after the two places, as it resolved them", async () => {
    // A line labelled "walking route" among three of them tells the human
    // nothing. The names are the ones the tool looked the places up as - the
    // same echo compare_areas makes - so the label on the map and the `from`
    // and `to` in the answer can never describe different walks.
    const { store, byName } = mapReady();
    const out = await call(byName.plan_route, { from: "Daan Station", to: "Taipei Main Station" });

    expect(out.label).toBe("walk: 大安 → 台北車站");
    expect(store.getDrawings()[0].label).toBe("walk: 大安 → 台北車站");
    expect(out.from).toEqual({ lng: 121.5436, lat: 25.0334, name: "大安" });
    expect(out.to).toEqual({ lng: 121.517, lat: 25.0478, name: "台北車站" });
  });

  it("falls back to a short honest name when an end was only a coordinate", async () => {
    // There is no name to use, and naming it after one end would claim a walk
    // between two places when only one of them was named.
    const { byName } = mapReady();
    const out = await call(byName.plan_route, {
      from: { lng: 121.5436, lat: 25.0334 },
      to: "osm:node:1",
    });
    expect(out.label).toBe(DEFAULT_ROUTE_LABEL);
  });

  it("falls back rather than cutting a label that would not fit", async () => {
    // A label truncated mid-destination would name a walk to somewhere else.
    const named = (id: string, name: string, coordinates: Position): GlassMapFeature => ({
      type: "Feature",
      properties: { id, name, category: "park", source: "osm" },
      geometry: { type: "Point", coordinates: coordinates as [number, number] },
    });
    const { byName } = mapReady(undefined, {
      features: [
        named("osm:way:900", "A".repeat(40), [121.5, 25.05]),
        named("osm:way:901", "B".repeat(40), [121.51, 25.06]),
      ],
    });
    const out = await call(byName.plan_route, { from: "osm:way:900", to: "osm:way:901" });

    expect(`walk: ${"A".repeat(40)} → ${"B".repeat(40)}`.length).toBeGreaterThan(MAX_LABEL_CHARS);
    expect(out.label).toBe(DEFAULT_ROUTE_LABEL);
  });

  it("keeps the caller's own label when it gave one", async () => {
    const { store, byName } = mapReady();
    const out = await call(byName.plan_route, {
      from: "osm:node:2",
      to: "osm:node:1",
      label: "morning commute",
    });
    expect(out.label).toBe("morning commute");
    expect(store.getDrawings()[0].label).toBe("morning commute");
  });

  it("refuses an oversized label before spending a request on it", async () => {
    // Validation comes first for a reason: a call that is going to be refused
    // must not cost one of the service's seconds.
    const { store, byName, requests } = mapReady();
    const out = await call(byName.plan_route, {
      from: "osm:node:2",
      to: "osm:node:1",
      label: "x".repeat(MAX_LABEL_CHARS + 1),
    });

    expect(out.error).toMatch(String(MAX_LABEL_CHARS));
    expect(requests).toEqual([]);
    expect(store.getDrawings()).toEqual([]);
  });
});

describe("plan_route: when the service cannot answer", () => {
  const failsWith = async (answer: Answer) => {
    const { store, byName } = mapReady(answer);
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
    // The same two promises on every failure path: no invented line, and an
    // answer that says the map did not change so the agent does not go looking
    // for a drawing that is not there.
    expect(store.getDrawings()).toEqual([]);
    expect(out.drawing_id).toBeUndefined();
    expect(out.error).toMatch(/map is unchanged/);
    expect(out.state?.drawings).toEqual({ count: 0, items: [] });
    return out;
  };

  it("relays a refusal the service sent with HTTP 200", async () => {
    // OSRM answers "no route" with a 200 and a code, so a tool that trusted the
    // status line would draw nothing and report success.
    const out = await failsWith(() => ({ code: "NoRoute", message: "Impossible route" }));
    expect(out.error).toMatch(/no walking route between these two points/);
    expect(out.error).toMatch(/Impossible route/);
  });

  it("quotes an unfamiliar status rather than inventing a reason for it", async () => {
    const out = await failsWith(() => ({ code: "InvalidQuery" }));
    expect(out.error).toMatch(/"InvalidQuery"/);
  });

  it("says plainly when the service could not be reached at all", async () => {
    const out = await failsWith(() => {
      throw new Error("503 Service Unavailable");
    });
    expect(out.error).toMatch(/could not be reached: 503 Service Unavailable/);
  });

  it("tells a timeout apart from a refusal, because asking again may work", async () => {
    const out = await failsWith(() => {
      // What AbortSignal.timeout rejects with.
      throw Object.assign(new Error("The operation was aborted."), { name: "TimeoutError" });
    });
    expect(out.error).toMatch(`no answer after ${ROUTE_TIMEOUT_MS / 1000}s`);
  });

  it("refuses an answer it cannot read instead of drawing part of one", async () => {
    // A body that is 200 and "Ok" but has no usable line is the failure most
    // likely to end up on the map as a broken shape.
    expect((await failsWith(() => ({ code: "Ok", routes: [] }))).error).toMatch(/no route in it/);
    expect(
      (await failsWith(() => routeOkBody([[121.5, 25.03]]))).error,
    ).toMatch(/fewer than two points/);
    const noDuration = {
      code: "Ok",
      routes: [
        {
          distance: 100,
          geometry: {
            type: "LineString",
            coordinates: [
              [121.5, 25.03],
              [121.51, 25.04],
            ],
          },
        },
      ],
    };
    expect((await failsWith(() => noDuration)).error).toMatch(/without a usable distance/);
    expect((await failsWith(() => "not json at all")).error).toMatch(/cannot read/);
  });

  it("refuses a negative distance or duration, which no walk can have", async () => {
    // The one bad number that would otherwise pass every check in the module
    // and come out the far end as an answer: "Planned a walk, -100 m", in the
    // JSON the agent reads *and* in the row a human watches. A service having
    // a bad moment, a proxy rewriting a body, a mirror with a bug - the tool
    // does not need to know which to know this is not an answer.
    const backwards = await failsWith((from, to) =>
      routeOkBody([from, to], -100, ROUTE_FIXTURE_DURATION),
    );
    expect(backwards.error).toMatch(/without a usable distance or duration/);
    expect(backwards.distance_m).toBeUndefined();

    const negativeTime = await failsWith((from, to) =>
      routeOkBody([from, to], ROUTE_FIXTURE_DISTANCE, -60),
    );
    expect(negativeTime.error).toMatch(/without a usable distance or duration/);
  });
});

describe("plan_route: when the caller gives up", () => {
  /** The same call, with a signal the test controls. */
  const callWith = async (
    tool: GlassMapTool,
    controller: AbortController,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => (await tool.execute(input, { signal: controller.signal })) as ToolResult;

  it("draws nothing, and asks nothing, when the call was already cancelled", async () => {
    // A client that has given up is still owed an answer, and the service is
    // owed no request at all: this one costs a second of somebody else's rate
    // limit for a route nobody will read.
    const { store, byName, requests } = mapReady();
    const controller = new AbortController();
    controller.abort();
    const out = await callWith(byName.plan_route, controller, {
      from: "osm:node:2",
      to: "osm:node:1",
    });

    expect(out.error).toMatch(/cancelled/);
    expect(out.error).toMatch(/map is unchanged/);
    expect(out.state?.drawings).toEqual({ count: 0, items: [] });
    expect(requests).toEqual([]);
    expect(store.getDrawings()).toEqual([]);
  });

  it("does not draw a route the caller stopped waiting for", async () => {
    // The reason this tool reads the signal at all: it is the only one whose
    // window is seconds wide and ends in a write. A client that cancels
    // mid-request has no record of this call, so a line appearing on the human's
    // map afterwards belongs to nobody - it cannot be explained, and the agent
    // cannot even name the id to remove it.
    const controller = new AbortController();
    const requests: string[] = [];
    const store = createMemoryToolStore({ features: FIXTURE_FEATURES, view: VIEW });
    resetRouteThrottle();
    const byName = Object.fromEntries(
      createMapTools(store, {
        routeFetch: async (url) => {
          requests.push(url);
          // The client gives up while the service is answering.
          controller.abort();
          return routeOkBody([DAAN, MAIN]);
        },
      }).map((t) => [t.name, t]),
    );
    const out = await callWith(byName.plan_route, controller, {
      from: "osm:node:2",
      to: "osm:node:1",
    });

    // The request did go out - it was already in flight - but nothing it
    // brought back reached the map.
    expect(requests).toHaveLength(1);
    expect(out.error).toMatch(/cancelled/);
    expect(out.drawing_id).toBeUndefined();
    expect(store.getDrawings()).toEqual([]);
  });
});

describe("plan_route: FOSSGIS' one request per second", () => {
  it("waits out the remainder of the second instead of firing early", async () => {
    // The policy is the price of using someone else's service for free. A tool
    // that refused the second call would push the rate limit onto the agent,
    // which cannot see a clock; waiting makes the call late, never lost.
    const { byName, requests } = mapReady();
    vi.useFakeTimers();
    try {
      resetRouteThrottle();
      await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
      expect(requests).toHaveLength(1);

      const second = call(byName.plan_route, { from: "osm:node:1", to: "osm:node:3" });
      await vi.advanceTimersByTimeAsync(ROUTE_MIN_INTERVAL_MS - 1);
      expect(requests).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect((await second).error).toBeUndefined();
      expect(requests).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues calls made at once in the order they were made, and refuses none", async () => {
    // Two surfaces can hold the tools at the same time (the app and the dev
    // shim), so "one at a time" has to survive three calls in one tick - and
    // the third route must be the third one asked for, not whichever won.
    const { byName, requests } = mapReady();
    vi.useFakeTimers();
    try {
      resetRouteThrottle();
      const calls = [
        call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" }),
        call(byName.plan_route, { from: "osm:node:2", to: "osm:node:3" }),
        call(byName.plan_route, { from: "osm:node:2", to: "osm:way:10" }),
      ];
      await vi.advanceTimersByTimeAsync(2 * ROUTE_MIN_INTERVAL_MS);
      const outs = await Promise.all(calls);

      expect(outs.map((o) => o.error)).toEqual([undefined, undefined, undefined]);
      expect(outs.map((o) => o.drawing_id)).toEqual(["drawing:1", "drawing:2", "drawing:3"]);
      expect(requests.map((url) => routeRequestPoints(url)[1])).toEqual([
        [121.517, 25.0478],
        [121.535, 25.033],
        [121.53575, 25.0295],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a call whose turn is further off than an agent can be kept waiting", async () => {
    // Waiting is right for a busy second and wrong for a busy minute: the fetch
    // timeout cannot see the queue, so an unbounded wait is the one failure an
    // agent can neither report nor retry - it just looks like the tool stopped
    // answering. Past the ceiling it gets a refusal it can act on instead, and
    // the service is asked nothing.
    const { store, byName, requests } = mapReady();
    vi.useFakeTimers();
    try {
      resetRouteThrottle();
      const ask = () => call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
      // Slots at 0s, 1s ... 5s: the last of them waits exactly the ceiling and
      // is still served, because the boundary is a wait too long, not one long
      // enough.
      const queued = Array.from({ length: ROUTE_MAX_WAIT_MS / ROUTE_MIN_INTERVAL_MS + 1 }, ask);
      const refused = await ask();

      expect(refused.error).toMatch(/too many route requests at once/);
      expect(refused.error).toMatch(/Ask again in a moment/);
      expect(refused.error).toMatch(/map is unchanged/);
      expect(refused.drawing_id).toBeUndefined();

      await vi.advanceTimersByTimeAsync(ROUTE_MAX_WAIT_MS);
      const served = await Promise.all(queued);
      expect(served.map((o) => o.error)).toEqual(served.map(() => undefined));
      // Six went out, the seventh never did: a refusal costs the service nothing.
      expect(requests).toHaveLength(6);
      expect(store.getDrawings()).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not push the queue back for a call it refused", async () => {
    // A refusal that still booked its second would make one burst refuse calls
    // made long after it: the queue would grow by exactly the calls it is
    // rejecting. The next free second has to be the one the refused call did
    // not take.
    const { byName, requests } = mapReady();
    vi.useFakeTimers();
    try {
      resetRouteThrottle();
      const ask = () => call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
      const queued = Array.from({ length: 6 }, ask);
      expect((await ask()).error).toMatch(/too many route requests at once/);

      await vi.advanceTimersByTimeAsync(ROUTE_MAX_WAIT_MS);
      await Promise.all(queued);
      expect(requests).toHaveLength(6);

      // Now at 5s, with the last slot taken at 5s. The next one is 6s - not 7s,
      // which is where it would be if the refusal had taken a slot of its own.
      const after = ask();
      await vi.advanceTimersByTimeAsync(ROUTE_MIN_INTERVAL_MS - 1);
      expect(requests).toHaveLength(6);
      await vi.advanceTimersByTimeAsync(1);
      expect((await after).error).toBeUndefined();
      expect(requests).toHaveLength(7);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("plan_route: a line the map can redraw", () => {
  /** A wobbling route, so simplification has real corners to keep. */
  const wobbly = (n: number): Position[] =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [
        DAAN[0] + (MAIN[0] - DAAN[0]) * t,
        DAAN[1] + (MAIN[1] - DAAN[1]) * t + Math.sin(i / 3) * 0.00008,
      ];
    });

  it("leaves a route the map can already redraw exactly as the service drew it", async () => {
    // 181 points is what the live service answered for a 3.8 km Taipei walk:
    // the normal case must arrive whole, not smoothed for no reason.
    const { store, byName } = mapReady((from, to) => routeOkBody([from, ...wobbly(179), to]));
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(out.points).toBe(181);
    expect(out.simplified).toBeUndefined();
    expect(storedLine(store)).toHaveLength(181);
  });

  it("simplifies a route past the ceiling, keeping both ends and saying it did", async () => {
    // MAX_SHAPE_POINTS is what the page can redraw on every frame - the same
    // ceiling an agent's own draw_shape is held to. The ends are what make a
    // simplified line still the walk that was asked for, and `simplified` is
    // why measuring the drawing can come back shorter than distance_m.
    const { store, byName } = mapReady((from, to) =>
      routeOkBody([from, ...wobbly(2000), to]),
    );
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(out.error).toBeUndefined();
    expect(out.points).toBeLessThanOrEqual(MAX_SHAPE_POINTS);
    expect(out.points).toBeGreaterThan(1);
    expect(out.simplified).toBe(true);
    // Not the drawn line's length: the walk is still the one the service found.
    expect(out.distance_m).toBe(3830);

    const line = storedLine(store);
    expect(line).toHaveLength(out.points!);
    expect(line[0]).toEqual(DAAN);
    expect(line[line.length - 1]).toEqual(MAIN);
  });

  it("decimates as a last resort, still keeping the ends", async () => {
    // The guard behind the simplifier: if turf ever refuses a line, the store
    // must still not be handed one the map cannot redraw.
    const many: Position[] = Array.from({ length: 1234 }, (_, i) => [121.5 + i * 1e-5, 25.03]);
    const kept = decimateRoutePoints(many);

    expect(kept.length).toBeLessThanOrEqual(MAX_SHAPE_POINTS);
    expect(kept[0]).toEqual(many[0]);
    expect(kept[kept.length - 1]).toEqual(many[many.length - 1]);
    // A line already inside the ceiling is untouched, so nothing loses detail
    // it did not have to.
    expect(decimateRoutePoints(many.slice(0, 500))).toHaveLength(500);
  });
});

describe("plan_route: the contract", () => {
  it("is a write tool whose output is marked untrusted", async () => {
    // Not readOnlyHint: it changes the map, and a client that gates writes has
    // to see this one. untrustedContentHint because the line and its numbers
    // come from a third-party service, and the state it returns echoes labels
    // a human typed.
    const { byName } = mapReady();
    expect(byName.plan_route.annotations).toEqual({ untrustedContentHint: true });
  });

  it("describes where the route comes from and what it cannot be asked", async () => {
    // The description is the only documentation an agent gets: it has to say
    // whose data this is, that the walk is on foot, and that a line has no
    // inside - `within` on one is the mistake the schema cannot prevent.
    const { byName } = mapReady();
    const description = byName.plan_route.description;

    expect(description).toMatch(/FOSSGIS/);
    expect(description).toMatch(/OpenStreetMap/);
    expect(description).toMatch(/walking/i);
    expect(description).toMatch(/no inside/);
    expect(description).toMatch(/measure/);
  });

  it("accepts exactly from, to and label", async () => {
    const { byName } = mapReady();
    const schema = byName.plan_route.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["from", "label", "to"]);
    expect(schema.required.sort()).toEqual(["from", "to"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("uses the live FOSSGIS service when nothing is injected", async () => {
    // The default has to be the real one, or the app ships a tool that can only
    // work in tests. Asserted without calling it: `fetch` is never reached.
    const store = createMemoryToolStore({ features: FIXTURE_FEATURES });
    const tools = createMapTools(store);
    expect(tools.map((t) => t.name)).toContain("plan_route");
    expect(ROUTE_SERVICE_URL).toBe(
      "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    );
  });

  it("never throws, whatever the injected service does", async () => {
    // The layer's hardest rule. A tool that throws takes the agent's turn down
    // with it, and this is the one tool with somebody else's code in its path.
    const rogue: RouteFetch = () => {
      throw { nope: true };
    };
    const store = createMemoryToolStore({ features: FIXTURE_FEATURES, view: VIEW });
    resetRouteThrottle();
    const byName = Object.fromEntries(
      createMapTools(store, { routeFetch: rogue }).map((t) => [t.name, t]),
    );
    const out = await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(out.error).toMatch(/could not be reached/);
    expect(store.getDrawings()).toEqual([]);
  });
});
