/**
 * Which effect an event asks for, what it is allowed to draw, and what it
 * claims while it runs. All of it is a pure function of the event plus a
 * read-only snapshot of the store, so the whole registry — the tool→effect
 * map, the degradation table and the preemption keys — is unit tested in node
 * with no DOM and no map.
 *
 * Two rules from the spec are structural here rather than conventional:
 *
 *  - **Never invent coordinates.** An effect whose geometry is not in the
 *    event or in the store degrades to `{ kind: "none" }` — the feed row still
 *    glows, the map stays calm. Drawing a compass sweep at the view centre
 *    because the real origin was missing would be the map telling a lie about
 *    where the agent looked.
 *  - **Preemption keys on target identity, never on effect name** (spec v2
 *    concurrency rule 3). Two `draw_shape` calls on different shapes are
 *    independent and coexist; a `describe_surroundings` and a `compare_areas`
 *    about the same place are the same target and the later one replaces the
 *    earlier.
 */
import {
  ACTIVITY_FX_HIT_LIMIT,
  type ActivityFx,
  type Annotation,
  type Drawing,
  type LngLat,
  type MapView,
} from "@/lib/store/map-store";
import type { Geometry } from "geojson";
import { round5 } from "@/lib/map-tools/state";
import { positionsOf } from "../drawing-style";

/**
 * Effects are named after the tool that causes them (plus the three human
 * actions), because that is the name the spec, the mockup and the feed row all
 * use — and it is what `data-fx-name` reports to QA.
 */
export type FxName =
  | "get_map_state"
  | "set_map_view"
  | "list_features_in_view"
  | "find_features"
  | "select_features"
  | "draw_shape"
  | "annotate"
  | "describe_surroundings"
  | "compare_areas"
  | "measure"
  | "get_share_link"
  | "human_draw"
  | "human_note"
  | "human_delete";

/** The shape `find_features` interrogated: a radius around a point, or an artifact. */
export type FxShape =
  | { type: "circle"; at: LngLat; radius_m: number }
  | { type: "path"; positions: LngLat[]; closed: boolean };

/**
 * What an effect is allowed to draw. `none` is the degraded form every
 * map-space effect falls back to: the effect still plays (and still glows its
 * feed row) but puts nothing on the map.
 */
export type FxGeom =
  | { kind: "none" }
  | { kind: "viewport" }
  | { kind: "chip" }
  | { kind: "reticle"; at: LngLat }
  | { kind: "find"; shape: FxShape | null; hits: LngLat[] }
  | { kind: "select"; points: LngLat[] }
  | { kind: "path"; positions: LngLat[]; closed: boolean }
  | { kind: "measure"; positions: LngLat[]; closed: boolean }
  | { kind: "pin"; at: LngLat; id: string }
  | { kind: "compass"; at: LngLat; radius_m: number }
  | { kind: "twin"; a: LngLat; b: LngLat; radius_m: number }
  | { kind: "vanish"; positions: LngLat[]; closed: boolean };

export interface FxPlan {
  name: FxName;
  /** Targets this effect occupies; intersecting sets preempt. Never empty. */
  keys: string[];
  geom: FxGeom;
  /**
   * The activity entry this effect belongs to, so its feed row glows on the
   * same clock. `null` for human actions, which make no feed row — the feed is
   * the *agent's* activity, and a human's own gesture is not a tool call.
   */
  seq: number | null;
}

/**
 * The activity entry as this layer needs to read it: the four fields an effect
 * is derived from, and nothing else. `ActivityEntry` satisfies it structurally,
 * so the real feed flows straight in while a test can state one row in four
 * lines instead of seven.
 *
 * `fx` is the tool layer's geometry echo (`ActivityEntry.fx`, T-70) — imported
 * rather than restated, so a change on that side is a compile error here rather
 * than a silently dead effect.
 */
export interface FxEntry {
  seq: number;
  tool: string;
  ok: boolean;
  refIds?: readonly string[];
  fx?: ActivityFx;
}

/** Everything the plan may read out of the store. Read-only by construction. */
export interface FxSource {
  view: MapView;
  drawings: readonly Drawing[];
  annotations: readonly Annotation[];
  selection: readonly string[];
  /** Where a selected id sits, or null when nothing has loaded it yet. */
  anchorOf(id: string): LngLat | null;
}

/**
 * How many anchors get a landing ring. Past this many the rest get none: the
 * shipped selection halo is already under every selected feature, so a 31st is
 * selected on screen, just without the drop-in. The cap counts anchors the
 * camera can actually see — the effect projects before it slices — so a wide
 * selection cannot spend its whole budget off screen.
 */
export const SELECT_BLOOM_CAP = 30;

/**
 * One glint per hit, up to the cap the tool layer already truncates `hitIds` at.
 * Taken from that constant rather than restated, so the two can never disagree
 * about how much of a page the map is showing.
 */
export const FIND_GLINT_CAP = ACTIVITY_FX_HIT_LIMIT;

/** Preemption key for a place. Rounded, so the same place is the same key across tools. */
export const originKey = ([lng, lat]: LngLat): string =>
  `origin:${round5(lng)},${round5(lat)}`;

/** The average of a geometry's positions — the anchor rule the halos already use. */
export function centroidOf(geometry: Geometry): LngLat | null {
  const positions = positionsOf(geometry);
  if (positions.length === 0) return null;
  const sum = positions.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [sum[0] / positions.length, sum[1] / positions.length];
}

/** A drawing's outline as a screen-projectable ring/line. */
function pathOf(drawing: Drawing): { positions: LngLat[]; closed: boolean } | null {
  const positions = positionsOf(drawing.geometry).map(([lng, lat]): LngLat => [lng, lat]);
  if (positions.length < 2) return null;
  return { positions, closed: drawing.kind !== "line" };
}

const isLngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);

const echoOrigin = (fx: ActivityFx | undefined, key: "origin" | "originB"): LngLat | null => {
  const value = fx?.[key];
  return isLngLat(value) ? [value[0], value[1]] : null;
};

const radiusOf = (fx: ActivityFx | undefined): number | null =>
  typeof fx?.radius_m === "number" && Number.isFinite(fx.radius_m) && fx.radius_m > 0
    ? fx.radius_m
    : null;

const drawingIn = (source: FxSource, ids: readonly string[] | undefined) =>
  source.drawings.find((d) => ids?.includes(d.id)) ?? null;

/** Nearest first, input order breaking ties — the stagger's reading order. */
function nearestFirst(points: LngLat[], to: LngLat): LngLat[] {
  return points
    .map((at, i) => ({ at, d: (at[0] - to[0]) ** 2 + (at[1] - to[1]) ** 2, i }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((p) => p.at);
}

/**
 * Where `find_features`' hit glints go, nearest to the queried shape first.
 * Ids come from `fx.hitIds`; a hit whose feature has not loaded contributes
 * nothing rather than a guessed point.
 */
function hitPoints(source: FxSource, ids: string[] | undefined, from: LngLat): LngLat[] {
  if (!ids?.length) return [];
  const out: LngLat[] = [];
  for (const id of ids.slice(0, FIND_GLINT_CAP)) {
    const at = source.anchorOf(id);
    if (at) out.push(at);
  }
  return nearestFirst(out, from);
}

/** Where a queried shape is centred, for the glints' nearest-first ordering. */
function shapeCentre(shape: FxShape | null, fallback: LngLat): LngLat {
  if (!shape) return fallback;
  if (shape.type === "circle") return shape.at;
  const sum = shape.positions.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [sum[0] / shape.positions.length, sum[1] / shape.positions.length];
}

/**
 * Selected features, nearest to the camera centre first.
 *
 * Nearest-first is the spec's N-scaling rule: the staggered landing has to
 * start where the human is already looking, otherwise a large selection reads
 * as noise arriving from off screen. Ties keep the agent's own input order, so
 * the same call always animates the same way.
 */
export function selectAnchors(source: FxSource): LngLat[] {
  const [cx, cy] = source.view.center;
  const found: { at: LngLat; d: number; i: number }[] = [];
  source.selection.forEach((id, i) => {
    const at = source.anchorOf(id);
    if (!at) return;
    found.push({ at, d: (at[0] - cx) ** 2 + (at[1] - cy) ** 2, i });
  });
  found.sort((a, b) => a.d - b.d || a.i - b.i);
  return found.map((f) => f.at);
}

/**
 * The agent-side registry: one activity entry → one effect, or null when the
 * call earns no effect at all.
 *
 * A refused call (`ok: false`) gets none: the grammar says motion on the map
 * means the map changed or was read, and nothing happened here. The feed row
 * already carries the refusal in words.
 */
export function planForEntry(entry: FxEntry, source: FxSource): FxPlan | null {
  if (!entry.ok) return null;
  const fx = entry.fx;
  const refIds = entry.refIds;
  const seq = entry.seq;
  const plan = (name: FxName, keys: string[], geom: FxGeom): FxPlan => ({
    name,
    keys: keys.length ? keys : [`tool:${name}`],
    geom,
    seq,
  });

  switch (entry.tool) {
    case "get_map_state":
      return plan("get_map_state", ["viewport"], { kind: "viewport" });

    case "list_features_in_view":
      return plan("list_features_in_view", ["viewport"], { kind: "viewport" });

    case "get_share_link":
      return plan("get_share_link", ["viewport"], { kind: "chip" });

    case "set_map_view": {
      // The only honest fallback in the whole table: the camera the store now
      // holds IS what the tool just set, so the reticle lands on the truth
      // even without the echo.
      const at = echoOrigin(fx, "origin") ?? source.view.center;
      return plan("set_map_view", ["camera"], { kind: "reticle", at });
    }

    case "select_features": {
      const points = selectAnchors(source);
      return plan("select_features", ["selection"], { kind: "select", points });
    }

    case "draw_shape": {
      const drawing = drawingIn(source, refIds);
      const path = drawing ? pathOf(drawing) : null;
      return plan(
        "draw_shape",
        drawing ? [drawing.id] : [],
        path ? { kind: "path", ...path } : { kind: "none" },
      );
    }

    case "measure": {
      const drawing = drawingIn(source, refIds);
      const path = drawing ? pathOf(drawing) : null;
      return plan(
        "measure",
        drawing ? [drawing.id] : [],
        path ? { kind: "measure", ...path } : { kind: "none" },
      );
    }

    case "annotate":
    case "add_note": {
      const annotation = source.annotations.find((a) => refIds?.includes(a.id)) ?? null;
      return plan(
        "annotate",
        annotation ? [annotation.id] : [],
        annotation ? { kind: "pin", at: annotation.at, id: annotation.id } : { kind: "none" },
      );
    }

    case "find_features": {
      const drawing = drawingIn(source, refIds);
      const path = drawing ? pathOf(drawing) : null;
      const origin = echoOrigin(fx, "origin");
      const radius = radiusOf(fx);
      const shape: FxShape | null = path
        ? { type: "path", ...path }
        : origin && radius
          ? { type: "circle", at: origin, radius_m: radius }
          : null;
      const hits = hitPoints(source, fx?.hitIds, shapeCentre(shape, source.view.center));
      const keys = drawing ? [drawing.id] : origin ? [originKey(origin)] : [];
      return plan(
        "find_features",
        keys,
        shape || hits.length ? { kind: "find", shape, hits } : { kind: "none" },
      );
    }

    case "describe_surroundings": {
      const origin = echoOrigin(fx, "origin");
      const radius = radiusOf(fx);
      return plan(
        "describe_surroundings",
        origin ? [originKey(origin)] : [],
        origin && radius ? { kind: "compass", at: origin, radius_m: radius } : { kind: "none" },
      );
    }

    case "compare_areas": {
      const a = echoOrigin(fx, "origin");
      const b = echoOrigin(fx, "originB");
      const radius = radiusOf(fx);
      const keys = [a, b].filter((o): o is LngLat => o !== null).map(originKey);
      return plan(
        "compare_areas",
        keys,
        a && b && radius ? { kind: "twin", a, b, radius_m: radius } : { kind: "none" },
      );
    }

    default:
      return null;
  }
}

/** A user gesture the store noticed. The human trio is triggered from state, not the feed. */
export type HumanEvent =
  | { type: "draw"; drawing: Drawing }
  | { type: "note"; annotation: Annotation }
  | { type: "delete"; geometry: Geometry; id: string };

/**
 * The human half of the grammar: the same three verbs in rose. There is no
 * activity entry to key to, so `seq` is null and no row glows — a person's own
 * gesture is not agent activity, and the feed must not claim it was.
 */
export function planForHuman(event: HumanEvent): FxPlan | null {
  switch (event.type) {
    case "draw": {
      const path = pathOf(event.drawing);
      if (!path) return null;
      return { name: "human_draw", keys: [event.drawing.id], geom: { kind: "path", ...path }, seq: null };
    }
    case "note":
      return {
        name: "human_note",
        keys: [event.annotation.id],
        geom: { kind: "pin", at: event.annotation.at, id: event.annotation.id },
        seq: null,
      };
    case "delete": {
      const positions = positionsOf(event.geometry).map(([lng, lat]): LngLat => [lng, lat]);
      if (positions.length === 0) return null;
      return {
        name: "human_delete",
        keys: [event.id],
        geom: { kind: "vanish", positions, closed: positions.length > 2 },
        seq: null,
      };
    }
  }
}

/** True when the two effects are about the same thing and must not overlap. */
export function keysClash(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}
