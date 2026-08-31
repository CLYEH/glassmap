import { describe, expect, it } from "vitest";
import type { ActivityFx, Annotation, Drawing, LngLat, MapView } from "@/lib/store/map-store";
import { DEFAULT_VIEW } from "@/lib/store/map-store";
import { describeCall } from "@/lib/map-tools/activity";
import { IMPERATIVE_TOOLS } from "../tool-roster";
import {
  DISSOLVE_CAP,
  keysClash,
  originKey,
  planForEntry,
  planForHuman,
  selectAnchors,
  type FxEntry,
  type FxOutline,
  type FxSource,
} from "./plan";

const CIRCLE: Drawing = {
  id: "drawing:1",
  source: "agent",
  kind: "circle",
  center: [121.5436, 25.0334],
  radius_m: 800,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.55, 25.0334],
        [121.5436, 25.04],
        [121.537, 25.0334],
        [121.5436, 25.027],
        [121.55, 25.0334],
      ],
    ],
  },
};

/**
 * What `plan_route` leaves behind: an ordinary line drawing whose points are
 * the streets the service routed along. Its ends are deliberately NOT the two
 * places below — a router snaps each end to the nearest street it knows.
 */
const ROUTE: Drawing = {
  id: "drawing:route",
  source: "agent",
  kind: "line",
  label: "walk: 大安站 → 大安森林公園",
  geometry: {
    type: "LineString",
    coordinates: [
      [121.54355, 25.03335],
      [121.54021, 25.03312],
      [121.53615, 25.03051],
    ],
  },
};

/** The two places the caller named, as the tool resolved them. */
const WALK_ENDS: ActivityFx = {
  origin: [121.5436, 25.0334],
  originB: [121.53609, 25.03045],
};

const NOTE: Annotation = {
  id: "annotation:1",
  source: "agent",
  at: [121.54, 25.03],
  note: "quiet street",
};

function source(patch: Partial<FxSource> = {}): FxSource {
  const anchors = new Map<string, LngLat>([
    ["osm:node:1", [121.6, 25.05]],
    ["osm:node:2", [121.5436, 25.0334]],
    ["osm:node:3", [121.55, 25.04]],
  ]);
  return {
    view: DEFAULT_VIEW as MapView,
    drawings: [CIRCLE],
    annotations: [NOTE],
    selection: [],
    anchorOf: (id) => anchors.get(id) ?? null,
    // Nothing has left this map: a test that wants a ghost says so.
    ghostOf: () => null,
    ...patch,
  };
}

const entry = (patch: Partial<FxEntry> & { tool: string }): FxEntry => ({
  seq: 7,
  ok: true,
  ...patch,
});

/**
 * Tools that are deliberately silent on the map. Empty, and it staying empty is
 * the point: the README promises that every tool call renders a brief effect,
 * so leaving one out has to be a decision written down here rather than a case
 * somebody forgot to add to `planForEntry`.
 */
const WITHOUT_EFFECT: readonly string[] = [];

describe("the tool → effect registry", () => {
  it("gives every imperative tool an effect, and names it after the tool", () => {
    // Derived from the roster the landing screen prints — which
    // `tool-roster.test.ts` holds equal to the tools actually registered — so a
    // fourteenth tool cannot ship drawing nothing. The feed row, the spec, the
    // mockup and `data-fx-name` all say the tool's name; a second vocabulary
    // here would make a frame unreadable against shots-v3.
    const expected = IMPERATIVE_TOOLS.filter((tool) => !WITHOUT_EFFECT.includes(tool));
    const planned = expected.map(
      (tool) => planForEntry(entry({ tool, refIds: ["drawing:1"] }), source())?.name ?? null,
    );
    expect(planned).toEqual([...expected]);
  });

  it("plays the pin drop for an agent-submitted add_note form", () => {
    // The declarative form is a tool call like any other; the human's own
    // submit is the rose effect, told by the form itself, not by the feed.
    const plan = planForEntry(
      entry({ tool: "add_note", refIds: ["annotation:1"] }),
      source(),
    );
    expect(plan).toMatchObject({ name: "annotate", geom: { kind: "pin", id: "annotation:1" } });
  });

  it("draws nothing for a refused call", () => {
    // A refusal changed nothing and read nothing. Motion on the map would be
    // the one thing in this design that lies.
    expect(planForEntry(entry({ tool: "draw_shape", ok: false }), source())).toBeNull();
  });

  it("ignores a tool it has no effect for rather than inventing one", () => {
    expect(planForEntry(entry({ tool: "teleport" }), source())).toBeNull();
  });

  it("carries the entry's seq so the feed row glows on the effect's own clock", () => {
    expect(planForEntry(entry({ tool: "get_map_state" }), source())?.seq).toBe(7);
  });
});

describe("the degradation table", () => {
  it("falls back to the store's camera for set_map_view, which cannot be wrong", () => {
    // The camera the store holds IS what the tool just set. This is the only
    // fallback in the table, and it is a fact rather than a guess.
    const plan = planForEntry(entry({ tool: "set_map_view" }), source());
    expect(plan?.geom).toEqual({ kind: "reticle", at: DEFAULT_VIEW.center });
  });

  it("prefers the echoed centre over the store when the tool reported one", () => {
    const plan = planForEntry(
      entry({ tool: "set_map_view", fx: { origin: [121.1, 25.1] } }),
      source(),
    );
    expect(plan?.geom).toEqual({ kind: "reticle", at: [121.1, 25.1] });
  });

  it("degrades describe_surroundings to a feed-row glow with no origin echo", () => {
    // Sweeping a compass over the view centre because the real origin was
    // missing would put the agent's gaze somewhere it never looked.
    const plan = planForEntry(entry({ tool: "describe_surroundings" }), source());
    expect(plan).toMatchObject({ name: "describe_surroundings", geom: { kind: "none" } });
  });

  it("degrades compare_areas unless BOTH origins and the shared radius are known", () => {
    const half = planForEntry(
      entry({ tool: "compare_areas", fx: { origin: [121.5, 25], radius_m: 500 } }),
      source(),
    );
    expect(half?.geom.kind).toBe("none");
    const full = planForEntry(
      entry({
        tool: "compare_areas",
        fx: { origin: [121.5, 25], originB: [121.6, 25.1], radius_m: 500 },
      }),
      source(),
    );
    expect(full?.geom).toMatchObject({ kind: "twin", radius_m: 500 });
  });

  it("finds within a shape from refIds alone — no echo needed", () => {
    // The `within` form is live today: the shape the agent named is in the
    // store, so the pulse has real geometry with or without T-70.
    const plan = planForEntry(
      entry({ tool: "find_features", refIds: ["drawing:1"] }),
      source(),
    );
    expect(plan?.geom).toMatchObject({ kind: "find", shape: { type: "path" } });
  });

  it("finds near a place only once the origin and radius are echoed", () => {
    const bare = planForEntry(entry({ tool: "find_features" }), source());
    expect(bare?.geom.kind).toBe("none");
    const echoed = planForEntry(
      entry({ tool: "find_features", fx: { origin: [121.5, 25], radius_m: 400 } }),
      source(),
    );
    expect(echoed?.geom).toMatchObject({
      kind: "find",
      shape: { type: "circle", at: [121.5, 25], radius_m: 400 },
    });
  });

  it("glints only the hits it can actually place", () => {
    // An id whose category has not loaded has no coordinate. Guessing one
    // would put a glint on a feature that is not there.
    const plan = planForEntry(
      entry({
        tool: "find_features",
        fx: { origin: [121.5436, 25.0334], radius_m: 400, hitIds: ["osm:node:1", "nope:9"] },
      }),
      source(),
    );
    expect(plan?.geom).toMatchObject({ kind: "find", hits: [[121.6, 25.05]] });
  });

  it("orders the glints nearest to the queried shape first", () => {
    const plan = planForEntry(
      entry({
        tool: "find_features",
        fx: {
          origin: [121.5436, 25.0334],
          radius_m: 900,
          hitIds: ["osm:node:1", "osm:node:3", "osm:node:2"],
        },
      }),
      source(),
    );
    expect(plan?.geom).toMatchObject({
      hits: [
        [121.5436, 25.0334],
        [121.55, 25.04],
        [121.6, 25.05],
      ],
    });
  });

  it("degrades draw_shape and measure when the shape is not in the store", () => {
    const empty = source({ drawings: [] });
    expect(planForEntry(entry({ tool: "draw_shape", refIds: ["drawing:1"] }), empty)?.geom.kind)
      .toBe("none");
    expect(planForEntry(entry({ tool: "measure", refIds: ["drawing:1"] }), empty)?.geom.kind)
      .toBe("none");
  });

  it("degrades select_features when nothing selected has a known position", () => {
    const plan = planForEntry(
      entry({ tool: "select_features" }),
      source({ selection: ["not:loaded"] }),
    );
    expect(plan?.geom).toEqual({ kind: "select", points: [] });
  });
});

describe("select ordering", () => {
  it("lands nearest the camera centre first, input order breaking ties", () => {
    // The staggered entrance has to start where the human is already looking;
    // ties keep the agent's order so the same call always animates the same way.
    const points = selectAnchors(
      source({
        view: { ...DEFAULT_VIEW, center: [121.6, 25.05] },
        selection: ["osm:node:2", "osm:node:1", "osm:node:3"],
      }),
    );
    expect(points[0]).toEqual([121.6, 25.05]);
    expect(points[2]).toEqual([121.5436, 25.0334]);
  });
});

describe("preemption keys", () => {
  it("keys on target identity, never on the effect's name", () => {
    // Two draws on different shapes are independent and must coexist; the
    // mockup keyed by name and could not express that.
    const one = planForEntry(entry({ tool: "draw_shape", refIds: ["drawing:1"] }), source());
    const two = planForEntry(
      entry({ tool: "draw_shape", refIds: ["drawing:2"] }),
      source({
        drawings: [CIRCLE, { ...CIRCLE, id: "drawing:2" }],
      }),
    );
    expect(one?.keys).toEqual(["drawing:1"]);
    expect(two?.keys).toEqual(["drawing:2"]);
    expect(keysClash(one!.keys, two!.keys)).toBe(false);
  });

  it("makes the three whole-viewport reads one target", () => {
    const names = ["get_map_state", "list_features_in_view", "get_share_link"];
    const keys = names.map((tool) => planForEntry(entry({ tool }), source())!.keys);
    expect(keys).toEqual([["viewport"], ["viewport"], ["viewport"]]);
  });

  it("gives describe and compare the same key for the same place", () => {
    // A compare that includes the place a describe is still sweeping is the
    // same story told better: it must replace it, not stack on it.
    const describe = planForEntry(
      entry({ tool: "describe_surroundings", fx: { origin: [121.54361, 25.03341], radius_m: 500 } }),
      source(),
    );
    const compare = planForEntry(
      entry({
        tool: "compare_areas",
        fx: { origin: [121.54361, 25.03341], originB: [121.5, 25.1], radius_m: 500 },
      }),
      source(),
    );
    expect(keysClash(describe!.keys, compare!.keys)).toBe(true);
  });

  it("rounds an origin key so the same place is the same key across tools", () => {
    expect(originKey([121.543612345, 25.033389])).toBe("origin:121.54361,25.03339");
  });

  it("never leaves an effect keyless, so a re-fired call preempts itself", () => {
    const plan = planForEntry(entry({ tool: "find_features" }), source());
    expect(plan?.keys).toEqual(["tool:find_features"]);
    expect(keysClash(plan!.keys, plan!.keys)).toBe(true);
  });
});

describe("the human trio", () => {
  it("inks a hand-drawn polygon and claims the shape's own id", () => {
    const plan = planForHuman({ type: "draw", drawing: { ...CIRCLE, source: "user" } });
    expect(plan).toMatchObject({ name: "human_draw", keys: ["drawing:1"], seq: null });
    expect(plan?.geom).toMatchObject({ kind: "path", closed: true });
  });

  it("makes no feed row: a person's gesture is not agent activity", () => {
    // The feed is the record of what an AGENT did. Glowing a row for a human
    // action would be the page claiming a tool call that never happened.
    expect(planForHuman({ type: "note", annotation: NOTE })?.seq).toBeNull();
    expect(planForHuman({ type: "draw", drawing: CIRCLE })?.seq).toBeNull();
  });

  it("dissolves a deleted artifact from the geometry it had, not from the store", () => {
    // By the time ✕ has been pressed the artifact is already out of the store;
    // the ghost is the only thing left that can say what left the map.
    const plan = planForHuman({
      type: "delete",
      geometry: { type: "Point", coordinates: [121.54, 25.03] },
      id: "annotation:1",
    });
    expect(plan).toMatchObject({
      name: "human_delete",
      keys: ["annotation:1"],
      geom: { kind: "dissolve", shapes: [{ positions: [[121.54, 25.03]], closed: false }] },
    });
  });
});

/**
 * The removal effect, which is the one write whose subject is already gone when
 * its row arrives. Everything here is about where the geometry comes from: get
 * that wrong and the tool the page just gained is the only one that animates
 * nothing.
 */
describe("remove_from_map", () => {
  const ghost: FxOutline = { positions: [[121.55, 25.0334], [121.5436, 25.04]], closed: true };

  it("dissolves a removed shape from the ghost it left, not from the store", () => {
    // By the time the feed row exists, `drawings` no longer holds the shape —
    // the same situation the human ✕ is in, answered the same way.
    const plan = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["drawing:1"] }),
      source({ drawings: [], ghostOf: (id) => (id === "drawing:1" ? ghost : null) }),
    );
    expect(plan).toMatchObject({ name: "remove_from_map", keys: ["drawing:1"] });
    expect(plan?.geom).toEqual({ kind: "dissolve", shapes: [ghost] });
  });

  it("fades a deselected place at its own anchor, which is still loaded", () => {
    // Deselecting takes a feature out of the highlight, not off the map: it has
    // no ghost, and its position is exactly where it still sits.
    const plan = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["osm:node:1"] }),
      source(),
    );
    expect(plan?.geom).toEqual({
      kind: "dissolve",
      shapes: [{ positions: [[121.6, 25.05]], closed: false }],
    });
  });

  it("dissolves a mixed batch together, and skips only what it cannot place", () => {
    // One call can take a shape, a note and a highlight off at once. An id
    // neither the ghost memory nor the feature index knows contributes nothing
    // — never a guessed point, the rule the whole table obeys.
    const plan = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["drawing:1", "osm:node:1", "gone:9"] }),
      source({ drawings: [], ghostOf: (id) => (id === "drawing:1" ? ghost : null) }),
    );
    expect(plan?.geom).toEqual({
      kind: "dissolve",
      shapes: [ghost, { positions: [[121.6, 25.05]], closed: false }],
    });
  });

  it("degrades to a feed-row glow when it can place nothing at all", () => {
    const plan = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["drawing:9"] }),
      source({ drawings: [] }),
    );
    expect(plan).toMatchObject({ name: "remove_from_map", geom: { kind: "none" } });
  });

  it("keys on every id it took off, so the ink still drawing that shape stops", () => {
    // A `draw_shape` effect animating a shape the next call removes would keep
    // inking a thing that is no longer on the map.
    const removal = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["drawing:1", "gone:9"] }),
      source({ drawings: [], ghostOf: () => ghost }),
    );
    const drawing = planForEntry(
      entry({ tool: "draw_shape", refIds: ["drawing:1"] }),
      source(),
    );
    expect(removal?.keys).toEqual(["drawing:1", "gone:9"]);
    expect(keysClash(removal!.keys, drawing!.keys)).toBe(true);
  });

  it("stops at the cap the tool's own answer is truncated to", () => {
    const ids = Array.from({ length: DISSOLVE_CAP + 5 }, (_, i) => `drawing:${i}`);
    const plan = planForEntry(
      entry({ tool: "remove_from_map", refIds: ids }),
      source({ drawings: [], ghostOf: () => ghost }),
    );
    expect(plan?.geom).toMatchObject({ kind: "dissolve" });
    expect(plan?.geom.kind === "dissolve" && plan.geom.shapes.length).toBe(DISSOLVE_CAP);
  });
});

/**
 * The route effect, which is the only one whose geometry the page could fake
 * convincingly: the row states both ends, so a straight line between them is
 * always available. Every case here is about refusing to draw one.
 */
describe("plan_route", () => {
  const walked = (patch: Partial<FxEntry> = {}) =>
    entry({ tool: "plan_route", refIds: ["drawing:route"], fx: WALK_ENDS, ...patch });

  it("draws the line the service returned, not a line between the two ends", () => {
    // The streets ARE the answer. A walking route rendered as the chord between
    // its endpoints would claim a path that does not exist — and the shape it
    // would take is the one `compare_areas` bows on purpose *because* a bow is
    // as far from a street-following route as a mark on a map can get.
    const plan = planForEntry(walked(), source({ drawings: [ROUTE] }));
    expect(plan).toMatchObject({ name: "plan_route", keys: ["drawing:route"] });
    expect(plan?.geom).toEqual({
      kind: "route",
      positions: [
        [121.54355, 25.03335],
        [121.54021, 25.03312],
        [121.53615, 25.03051],
      ],
      // The places the caller named, which is not where the line starts and
      // ends: the service snapped each one to the nearest street first.
      from: [121.5436, 25.0334],
      to: [121.53609, 25.03045],
    });
  });

  it("falls back to the line's own ends when the row states none", () => {
    // Not a guess: a route is simplified with its first and last point kept
    // (`map-tools/route.ts`), so the drawn line begins and ends where the walk
    // does. It is a poorer answer than the echo — it marks the street, not the
    // place — and it is still a true one.
    const plan = planForEntry(walked({ fx: undefined }), source({ drawings: [ROUTE] }));
    expect(plan?.geom).toMatchObject({
      from: [121.54355, 25.03335],
      to: [121.53615, 25.03051],
    });
  });

  it("degrades to a feed-row glow when the line is not in the store", () => {
    // The one case that matters: both ends are right there in the row, and the
    // answer is still nothing. Drawing them joined would put a walking route on
    // the map that no router ever planned.
    const plan = planForEntry(walked(), source({ drawings: [] }));
    expect(plan).toMatchObject({ name: "plan_route", geom: { kind: "none" } });
  });

  it("keys on the line it made, so two walks from one place coexist", () => {
    // A write's target is the artifact it made, exactly as for `draw_shape` —
    // not the places it names. Keying on the origins would make a second walk
    // out of the same station cut the first one's ink short, and both lines are
    // on the map.
    const first = planForEntry(walked(), source({ drawings: [ROUTE] }));
    const second = planForEntry(
      walked({
        refIds: ["drawing:route2"],
        fx: { origin: WALK_ENDS.origin, originB: [121.6, 25.05] },
      }),
      source({ drawings: [ROUTE, { ...ROUTE, id: "drawing:route2" }] }),
    );
    expect(second?.keys).toEqual(["drawing:route2"]);
    expect(keysClash(first!.keys, second!.keys)).toBe(false);
  });

  it("lets a removal of that route cut its ink short", () => {
    // The inverse of the rule above: the ink is drawing a line that has just
    // left the map, and must stop.
    const drawn = planForEntry(walked(), source({ drawings: [ROUTE] }));
    const removal = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["drawing:route"] }),
      source({ drawings: [], ghostOf: () => ({ positions: [[121.5, 25]], closed: false }) }),
    );
    expect(keysClash(drawn!.keys, removal!.keys)).toBe(true);
  });
});

/**
 * The lookup effect, which is the only read whose geometry comes from the
 * store rather than from an echo: `get_place_details` is handed an id, so its
 * row states `refIds` and no `fx` at all (`map-tools/activity.ts`). Everything
 * here is about that one substitution being made honestly.
 */
describe("get_place_details", () => {
  it("glints the place at the anchor the map already drew it on", () => {
    // The row names an id and nothing else. The point comes from the loaded
    // feature — the same anchor the selection halo uses — so the glint lands on
    // the mark under the human's eyes rather than on a second opinion about
    // where that place is.
    const plan = planForEntry(
      entry({ tool: "get_place_details", refIds: ["osm:node:1"] }),
      source(),
    );
    expect(plan).toMatchObject({ name: "get_place_details", keys: ["osm:node:1"] });
    expect(plan?.geom).toEqual({ kind: "place", at: [121.6, 25.05] });
  });

  it("degrades to a feed-row glow for an id this page has not loaded", () => {
    // An agent may look up an id it got from a share link before that link's
    // category has arrived. Glinting the view centre would say the agent read a
    // place that is not there; the row still lights, and the map stays calm.
    const plan = planForEntry(
      entry({ tool: "get_place_details", refIds: ["osm:node:9999"] }),
      source(),
    );
    expect(plan).toMatchObject({ name: "get_place_details", geom: { kind: "none" } });
  });

  it("never leaves itself keyless, so a re-asked lookup preempts the first", () => {
    const bare = planForEntry(entry({ tool: "get_place_details" }), source());
    expect(bare?.keys).toEqual(["tool:get_place_details"]);
    expect(bare?.geom.kind).toBe("none");
  });

  it("keys on the place, so removing it cuts the glint short", () => {
    // The read is about that feature. A `remove_from_map` that takes it out of
    // the highlight while the glint is still lit must stop it — the same rule
    // that stops `draw_shape`'s ink over a shape that just left.
    const lookup = planForEntry(
      entry({ tool: "get_place_details", refIds: ["osm:node:1"] }),
      source(),
    );
    const removal = planForEntry(
      entry({ tool: "remove_from_map", refIds: ["osm:node:1"] }),
      source(),
    );
    expect(keysClash(lookup!.keys, removal!.keys)).toBe(true);
  });

  it("does not clash with a lookup of a different place", () => {
    // Two questions about two places are two independent reads and coexist,
    // exactly as two draws on two shapes do. Keying by effect name would have
    // made the second one erase the first.
    const one = planForEntry(entry({ tool: "get_place_details", refIds: ["osm:node:1"] }), source());
    const two = planForEntry(entry({ tool: "get_place_details", refIds: ["osm:node:2"] }), source());
    expect(keysClash(one!.keys, two!.keys)).toBe(false);
  });
});

/**
 * The seam between the tool layer's geometry echo (T-70) and this registry.
 *
 * These do not restate what `describeCall` puts in `fx` — `activity.test.ts`
 * owns that. They assert the consequence: that a row the real summariser
 * produced actually lights the map up. Without them the two halves can drift
 * apart in silence — the echo keeps being written, the effect quietly stops
 * happening, and every other test in the repo still passes.
 */
describe("against the real tool-layer echo", () => {
  // Everything but `seq` and the tool's name comes from the tool layer, `ok`
  // included: these rows are the real thing, not a hand-written stand-in.
  const entryFor = (tool: string, input: object, result: object): FxEntry => ({
    seq: 1,
    tool,
    ...describeCall(tool, input, result),
  });

  it("drops set_map_view's reticle on the centre the tool answered with", () => {
    const entry = entryFor(
      "set_map_view",
      { place: "Daan Forest Park" },
      { center: { lng: 121.53609, lat: 25.03045 }, zoom: 15 },
    );
    expect(planForEntry(entry, source())?.geom).toEqual({
      kind: "reticle",
      at: [121.53609, 25.03045],
    });
  });

  it("sweeps describe_surroundings' compass at the resolved origin and radius", () => {
    const entry = entryFor(
      "describe_surroundings",
      { from: "Daan Forest Park", radius_m: 700 },
      { origin: { lng: 121.53609, lat: 25.03045 }, name: "大安森林公園", total: 12 },
    );
    expect(planForEntry(entry, source())?.geom).toEqual({
      kind: "compass",
      at: [121.53609, 25.03045],
      radius_m: 700,
    });
  });

  it("rings both of compare_areas' places at the one radius they share", () => {
    const entry = entryFor(
      "compare_areas",
      { a: "Daan Forest Park", b: "Daan Station" },
      {
        a: { name: "大安森林公園", origin: { lng: 121.53609, lat: 25.03045 } },
        b: { name: "大安站", origin: { lng: 121.5436, lat: 25.0334 } },
        radius_m: 500,
      },
    );
    expect(planForEntry(entry, source())?.geom).toEqual({
      kind: "twin",
      a: [121.53609, 25.03045],
      b: [121.5436, 25.0334],
      radius_m: 500,
    });
  });

  it("runs plan_route's ink along the drawing, between the ends it resolved", () => {
    // The row the real summariser writes carries the drawing in `refIds` and
    // the two ends in `fx` — this is the assertion that the effect reads both,
    // and the reason the tool layer echoes a second origin for a tool that
    // draws its own geometry.
    const entry = entryFor(
      "plan_route",
      { from: "Daan Station", to: "Daan Forest Park" },
      {
        drawing_id: "drawing:route",
        label: "walk: 大安站 → 大安森林公園",
        distance_m: 1240,
        duration_s: 921,
        points: 3,
        from: { lng: 121.5436, lat: 25.0334, name: "大安站" },
        to: { lng: 121.53609, lat: 25.03045, name: "大安森林公園" },
      },
    );
    expect(planForEntry(entry, source({ drawings: [ROUTE] }))?.geom).toMatchObject({
      kind: "route",
      from: [121.5436, 25.0334],
      to: [121.53609, 25.03045],
      positions: [
        [121.54355, 25.03335],
        [121.54021, 25.03312],
        [121.53615, 25.03051],
      ],
    });
  });

  it("glints find_features' own returned page, nearest to the origin first", () => {
    const entry = entryFor(
      "find_features",
      { categories: ["park"], near: "Daan Station", radius_m: 900 },
      {
        origin: { lng: 121.5436, lat: 25.0334 },
        radius_m: 900,
        total: 3,
        returned: 3,
        features: [{ id: "osm:node:1" }, { id: "osm:node:3" }, { id: "osm:node:2" }],
      },
    );
    expect(planForEntry(entry, source())?.geom).toEqual({
      kind: "find",
      shape: { type: "circle", at: [121.5436, 25.0334], radius_m: 900 },
      hits: [
        [121.5436, 25.0334],
        [121.55, 25.04],
        [121.6, 25.05],
      ],
    });
  });

  it("rings nothing for a search the tool never bounded", () => {
    // A query-only search measured distances from the view centre but looked
    // everywhere. Drawing a radius there would claim a limit the call did not
    // apply — the hits are the honest answer, and the hits alone is what shows.
    const entry = entryFor(
      "find_features",
      { query: "park" },
      {
        origin: { lng: 121.5436, lat: 25.0334 },
        total: 1,
        returned: 1,
        features: [{ id: "osm:node:1" }],
      },
    );
    expect(planForEntry(entry, source())?.geom).toMatchObject({
      kind: "find",
      shape: null,
      hits: [[121.6, 25.05]],
    });
  });

  it("lights get_place_details from the id the real row carries, not from an echo", () => {
    // The tool answers with a `coordinate`, and the summariser deliberately does
    // not echo it: the row states the id, and the map resolves it. This is the
    // assertion that the two halves agree about that — a summariser that
    // stopped writing `refIds` would leave the fourteenth tool as the one call
    // that animates nothing, and no other test in the repo would notice.
    const entry = entryFor(
      "get_place_details",
      { id: "osm:node:1" },
      {
        id: "osm:node:1",
        name: "伯朗咖啡館",
        name_en: "Mr. Brown",
        category: "cafe",
        coordinate: { lng: 121.55, lat: 25.04 },
        wheelchair: "yes",
      },
    );
    expect(entry.refIds).toEqual(["osm:node:1"]);
    expect(entry.fx).toBeUndefined();
    // The store's anchor for that id — NOT the coordinate in the answer, which
    // is the point of anchoring rather than echoing.
    expect(planForEntry(entry, source())?.geom).toEqual({ kind: "place", at: [121.6, 25.05] });
  });

  it("leaves the map calm for the tools whose answers state no point", () => {
    // Their geometry comes from `refIds` or from nowhere; the echo is
    // deliberately absent, and this layer must not fill the gap with the
    // current camera.
    for (const [tool, input, result] of [
      ["get_map_state", {}, { features_loaded: 2063 }],
      ["list_features_in_view", { categories: ["park"] }, { total: 17 }],
      ["select_features", {}, { state: { selection: { count: 6 } } }],
    ] as const) {
      expect(entryFor(tool, input, result).fx, tool).toBeUndefined();
    }
  });
});
