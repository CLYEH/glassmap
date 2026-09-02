import { beforeEach, describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { httpRouteFetch, resetRouteThrottle, type RouteFetch } from "@/lib/map-tools/route";
import {
  ROUTE_FIXTURE_BEND,
  createRouteFetch,
  routeOkBody,
  routeRequestPoints,
} from "@/lib/map-tools/test-fixtures";
import { useMapStore } from "@/lib/store/map-store";
import { useDrawStore, setRouteFetchForTests } from "./draw-store";
import { onHumanFx, type HumanEvent } from "./fx/human-events";

const draw = () => useDrawStore.getState();
const map = () => useMapStore.getState();

describe("draw store", () => {
  beforeEach(() => {
    useDrawStore.setState({ mode: "none", draft: [] });
    useMapStore.setState({ drawings: [], drawingSeq: 1 });
  });

  it("hands a finished polygon to the map store as a user drawing", () => {
    // This is the whole point of hand drawing: the shape has to end up where
    // the tools look, tagged as drawn by a human.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.6, 25]);
    draw().addVertex([121.6, 25.1]);
    const stored = draw().finish();

    expect(stored).toMatchObject({ id: "drawing:1", source: "user", kind: "polygon" });
    expect(map().drawings).toHaveLength(1);
    expect(map().drawings[0].geometry.type).toBe("Polygon");
  });

  it("leaves draw mode and clears the draft after finishing", () => {
    draw().start();
    for (const vertex of [
      [121.5, 25],
      [121.6, 25],
      [121.6, 25.1],
    ] as [number, number][]) {
      draw().addVertex(vertex);
    }
    draw().finish();

    expect(draw().mode).toBe("none");
    expect(draw().draft).toEqual([]);
  });

  it("refuses to store a shape with fewer than three corners, and keeps drawing", () => {
    // Enter or a double-click on the second point must not drop an empty
    // polygon into state an agent will later query.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.6, 25]);

    expect(draw().finish()).toBeNull();
    expect(map().drawings).toEqual([]);
    expect(draw().mode).toBe("polygon");
    expect(draw().draft).toHaveLength(2);
  });

  it("rounds every corner to ~1 m as it is clicked", () => {
    // The draft the preview draws and the polygon the store keeps have to be
    // the same numbers: rounding later, in whatever serializes a drawing for a
    // tool, would make the shape on screen and the shape an agent reads back
    // disagree.
    draw().start();
    draw().addVertex([121.5175123456, 25.0478987654]);
    expect(draw().draft).toEqual([[121.51751, 25.0479]]);

    draw().addVertex([121.6000004, 25.0000004]);
    draw().addVertex([121.6000004, 25.1000004]);
    const stored = draw().finish();
    expect(stored!.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [121.51751, 25.0479],
          [121.6, 25],
          [121.6, 25.1],
          [121.51751, 25.0479],
        ],
      ],
    });
  });

  it("treats two clicks inside the same metre as one corner", () => {
    // Rounding must not be able to smuggle a duplicate corner into a ring.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.5000001, 25.0000001]);
    draw().addVertex([121.6, 25]);
    expect(draw().finish()).toBeNull();
    expect(map().drawings).toEqual([]);
  });

  it("throws the draft away on cancel without touching the map store", () => {
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().cancel();

    expect(draw()).toMatchObject({ mode: "none", draft: [] });
    expect(map().drawings).toEqual([]);
  });

  it("starts from an empty draft every time", () => {
    // A cancelled-then-restarted drawing must not inherit old vertices.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().start();
    expect(draw().draft).toEqual([]);
  });
});

/**
 * The human half of `plan_route` (T-110). Two clicks, somebody else's server,
 * and a line that has to end up exactly where an agent's own route would: in
 * `drawings`, tagged `user`, labelled with the service's own figures.
 *
 * Nothing here touches the network — the service is injected, the same way
 * `lib/map-tools/route.test.ts` injects it — and the throttle is reset per
 * test so the suite is not paced by FOSSGIS' one-request-per-second policy.
 * What these tests are really about is the second between the two clicks and
 * the second after them: a walk must never appear that nobody is still asking
 * for, and a walk that could not be planned must leave the map alone and say
 * so where the person is already reading.
 */
describe("draw store: a walk planned by hand", () => {
  const START: [number, number] = [121.5175123456, 25.0478987654];
  const ROUNDED_START: [number, number] = [121.51751, 25.0479];
  const END: [number, number] = [121.54355, 25.03333];

  beforeEach(() => {
    useDrawStore.setState({
      mode: "none",
      draft: [],
      routeDraft: [],
      routeStatus: "idle",
      routeCredited: false,
    });
    useMapStore.setState({ drawings: [], drawingSeq: 1, activity: [], activitySeq: 1 });
    resetRouteThrottle();
    setRouteFetchForTests(httpRouteFetch);
  });

  /** A service that answers when the test says so, and counts what it was asked. */
  function pendingService() {
    const calls: string[] = [];
    let answer: ((body: unknown) => void) | null = null;
    const routeFetch: RouteFetch = (url) => {
      calls.push(url);
      return new Promise((resolve) => {
        answer = resolve;
      });
    };
    setRouteFetchForTests(routeFetch);
    return {
      calls,
      reply: (from: Position, to: Position) => answer?.(routeOkBody([from, ROUTE_FIXTURE_BEND, to])),
    };
  }

  it("turns the second click into a user line the tools can see", async () => {
    // The whole point of the gesture: the walk has to land where `plan_route`
    // lands its own, tagged as the person's, so `get_map_state`, `measure` and
    // `remove_from_map` all treat it as an ordinary drawing.
    const { routeFetch, requests } = createRouteFetch();
    setRouteFetchForTests(routeFetch);

    draw().startRoute();
    await draw().addRouteVertex(START);
    // One end is not a walk: nothing has been asked and nothing is on the map.
    expect(draw().routeDraft).toEqual([ROUNDED_START]);
    expect(requests).toEqual([]);
    expect(map().drawings).toEqual([]);

    await draw().addRouteVertex(END);

    expect(map().drawings).toHaveLength(1);
    expect(map().drawings[0]).toMatchObject({
      id: "drawing:1",
      source: "user",
      kind: "line",
      // The service's own distance and duration (3830.4 m, 2760.6 s), rounded
      // the way a person reads them.
      label: "walking route · 3.8 km · 47 min",
    });
    expect(map().drawings[0].geometry).toEqual({
      type: "LineString",
      coordinates: [ROUNDED_START, [121.5322, 25.04123], END],
    });
    // The rounded clicks are what was asked for, so the line starts where the
    // pin the person saw was.
    expect(requests).toHaveLength(1);
    expect(routeRequestPoints(requests[0])).toEqual([ROUNDED_START, END]);
    // And the gesture is over: the map answers questions again.
    expect(draw()).toMatchObject({ mode: "none", routeDraft: [], routeStatus: "idle" });
  });

  it("announces the walk as a person's own mark, not as agent activity", async () => {
    // The FX layer keys agent effects off the activity feed; a hand gesture
    // writes no row, so it has to announce itself — and the feed must not claim
    // the person's walk was the agent's work.
    const { routeFetch } = createRouteFetch();
    setRouteFetchForTests(routeFetch);
    const seen: HumanEvent[] = [];
    const off = onHumanFx((event) => seen.push(event));

    draw().startRoute();
    await draw().addRouteVertex(START);
    await draw().addRouteVertex(END);
    off();

    expect(seen).toEqual([{ type: "draw", drawing: map().drawings[0] }]);
    expect(map().activity).toEqual([]);
  });

  it("owes the routing service its credit from the first walk on, for good", async () => {
    // FOSSGIS asks for attribution in exchange for the route. A hand-planned
    // walk leaves no activity row, so `route-credit.ts` cannot see it: this
    // latch is the only thing that keeps the credit on screen — and it has to
    // survive the walk being cancelled, restarted or switched away from.
    const { routeFetch } = createRouteFetch();
    setRouteFetchForTests(routeFetch);
    expect(draw().routeCredited).toBe(false);

    draw().startRoute();
    await draw().addRouteVertex(START);
    await draw().addRouteVertex(END);
    expect(draw().routeCredited).toBe(true);

    draw().cancel();
    draw().startRoute();
    draw().start();
    expect(draw().routeCredited).toBe(true);
  });

  it("leaves the map alone and repeats the service's own sentence when it refuses", async () => {
    // OSRM reports "no route" with HTTP 200 and a code. The person has to be
    // told in words, in the hint they are already reading, and the map has to
    // stay exactly as it was — including staying in route mode, because the
    // next click is a new attempt rather than a lost gesture.
    const { routeFetch } = createRouteFetch(() => ({ code: "NoRoute" }));
    setRouteFetchForTests(routeFetch);

    draw().startRoute();
    await draw().addRouteVertex(START);
    await draw().addRouteVertex(END);

    expect(map().drawings).toEqual([]);
    expect(draw().mode).toBe("route");
    expect(draw().routeDraft).toEqual([]);
    expect(draw().routeStatus).toEqual({
      error:
        "the routing service could not plan this walk: there is no walking route between these two points. Nothing was drawn and the map is unchanged",
    });
    expect(draw().routeCredited).toBe(false);
  });

  it("says so in the same place when the service cannot be reached at all", async () => {
    // The failure a demo actually meets: no network, or a service that never
    // answers. It must read as a sentence and not as a stuck "Planning…".
    const { routeFetch } = createRouteFetch(() => {
      const timeout = new Error("The operation was aborted due to timeout");
      timeout.name = "TimeoutError";
      throw timeout;
    });
    setRouteFetchForTests(routeFetch);

    draw().startRoute();
    await draw().addRouteVertex(START);
    await draw().addRouteVertex(END);

    expect(draw().routeStatus).toEqual({
      error:
        "the routing service could not be reached: no answer after 8s. Nothing was drawn and the map is unchanged",
    });
    expect(map().drawings).toEqual([]);
    expect(draw().mode).toBe("route");
  });

  it("will not spend a request on a walk from a point to itself", async () => {
    // Two clicks inside the same metre are one place. Asking the service would
    // cost a request from a one-per-second budget to be told what this store
    // already knows, so the start stays and the hint says what is missing.
    const { routeFetch, requests } = createRouteFetch();
    setRouteFetchForTests(routeFetch);

    draw().startRoute();
    await draw().addRouteVertex(START);
    await draw().addRouteVertex([START[0] + 0.0000004, START[1] + 0.0000004]);

    expect(requests).toEqual([]);
    expect(draw().routeDraft).toEqual([ROUNDED_START]);
    expect(draw().routeStatus).toEqual({ error: "That is where the walk starts" });

    // A different second point is still all it takes: the gesture was waiting,
    // not broken.
    await draw().addRouteVertex(END);
    expect(requests).toHaveLength(1);
    expect(map().drawings).toHaveLength(1);
  });

  it("ignores clicks while the service is answering", async () => {
    // One walk per gesture. A person tapping again while "Planning…" is up
    // must not queue a second request against a one-per-second policy, and must
    // not move the end of the walk that is already being planned.
    const service = pendingService();

    draw().startRoute();
    await draw().addRouteVertex(START);
    void draw().addRouteVertex(END);
    expect(draw().routeStatus).toBe("planning");

    await draw().addRouteVertex([121.6, 25.1]);
    expect(service.calls).toHaveLength(1);
    expect(draw().routeDraft).toEqual([ROUNDED_START, END]);
  });

  it("never lands a walk the person cancelled while it was being planned", async () => {
    // The answer comes back a second later, from a server this page does not
    // control. Esc means the gesture is over, so the line that was still coming
    // must not appear on a map whose owner walked away from it.
    const service = pendingService();

    draw().startRoute();
    await draw().addRouteVertex(START);
    const planning = draw().addRouteVertex(END);
    // Let the request actually leave before pressing Esc: the case is a walk
    // the service is already working on, not one that was never asked for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.calls).toHaveLength(1);
    draw().cancel();
    service.reply(ROUNDED_START, END);
    await planning;

    expect(map().drawings).toEqual([]);
    expect(draw()).toMatchObject({ mode: "none", routeDraft: [], routeStatus: "idle" });
    expect(draw().routeCredited).toBe(false);
  });

  it("throws a half-clicked walk away on cancel, and on switching to drawing", async () => {
    // The two gestures share the map's clicks: a start left behind by one of
    // them would be read as the start of the other's next click.
    draw().startRoute();
    await draw().addRouteVertex(START);
    draw().cancel();
    expect(draw()).toMatchObject({ mode: "none", routeDraft: [], routeStatus: "idle" });

    draw().startRoute();
    await draw().addRouteVertex(START);
    draw().start();
    expect(draw()).toMatchObject({ mode: "polygon", routeDraft: [], routeStatus: "idle" });

    draw().addVertex([121.5, 25]);
    draw().startRoute();
    expect(draw()).toMatchObject({ mode: "route", draft: [], routeDraft: [] });
  });

  it("takes no click at all until the Route pill is pressed", async () => {
    // The map's ordinary clicks are questions about what is under them. Route
    // mode is the only state in which one of them is half of a walk.
    const { routeFetch, requests } = createRouteFetch();
    setRouteFetchForTests(routeFetch);

    await draw().addRouteVertex(START);
    expect(draw().routeDraft).toEqual([]);

    draw().start();
    await draw().addRouteVertex(START);
    expect(draw().routeDraft).toEqual([]);
    expect(requests).toEqual([]);
  });
});
