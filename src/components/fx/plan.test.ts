import { describe, expect, it } from "vitest";
import type { Annotation, Drawing, LngLat, MapView } from "@/lib/store/map-store";
import { DEFAULT_VIEW } from "@/lib/store/map-store";
import {
  keysClash,
  originKey,
  planForEntry,
  planForHuman,
  selectAnchors,
  type FxEntry,
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
    ...patch,
  };
}

const entry = (patch: Partial<FxEntry> & { tool: string }): FxEntry => ({
  seq: 7,
  ok: true,
  ...patch,
});

describe("the tool → effect registry", () => {
  it("gives every imperative tool an effect, and names it after the tool", () => {
    // The feed row, the spec, the mockup and `data-fx-name` all say the tool's
    // name; a second vocabulary here would make a frame unreadable against
    // shots-v3.
    const tools = [
      "get_map_state",
      "set_map_view",
      "list_features_in_view",
      "find_features",
      "select_features",
      "draw_shape",
      "annotate",
      "describe_surroundings",
      "compare_areas",
      "measure",
      "get_share_link",
    ];
    for (const tool of tools) {
      const plan = planForEntry(entry({ tool, refIds: ["drawing:1"] }), source());
      expect(plan?.name, tool).toBe(tool);
    }
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
      geom: { kind: "vanish", positions: [[121.54, 25.03]], closed: false },
    });
  });
});
