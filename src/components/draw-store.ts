import { create } from "zustand";
import { httpRouteFetch, planWalk, type RouteFetch } from "@/lib/map-tools/route";
import { useMapStore, type Drawing, type LngLat } from "@/lib/store/map-store";
import { polygonFromVertices } from "./drawing-style";
import { emitHumanFx } from "./fx/human-events";
import { routeLabel } from "./route-label";

/**
 * What the next click on the map means. "none" is the map answering questions
 * about what is on it; the other two are a hand gesture that owns the click.
 */
export type DrawMode = "none" | "polygon" | "route";

/**
 * Where a hand-planned walk is, between the second click and the answer.
 * "planning" is the one state that also swallows clicks — the routing service
 * is allowed one request per second and a person tapping twice must not spend
 * two of them.
 */
export type RouteStatus = "idle" | "planning" | { error: string };

/**
 * Hand-drawn corners are rounded to ~1 m as they are clicked, not on the way
 * out: the vertex the preview draws, the vertex the store keeps and the vertex
 * a tool reads back are then the same number. Rounding in a serializer instead
 * would make the stored shape and the reported shape disagree, and pixel-exact
 * clicks carry no information at that scale anyway.
 */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

const roundVertex = ([lng, lat]: LngLat): LngLat => [round5(lng), round5(lat)];

const samePoint = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/**
 * The routing service, injected so tests never touch the network. Module level
 * rather than a store field for the reason `route.ts` keeps its rate limiter
 * there: it is one service per page, and no tool may see or swap it.
 */
let routeFetch: RouteFetch = httpRouteFetch;

/** Tests only. `setRouteFetchForTests(httpRouteFetch)` puts the real one back. */
export function setRouteFetchForTests(fetchRoute: RouteFetch): void {
  routeFetch = fetchRoute;
}

/**
 * Which planning attempt is still wanted. A walk takes a round trip to somebody
 * else's server, and in that second the person can press Esc, start a new route
 * or switch to drawing a polygon — after which the answer, when it arrives,
 * must not put a line on the map nobody asked for any more. Every one of those
 * gestures invalidates the ticket the pending call is holding.
 */
let planTicket = 0;

/**
 * Hand-drawing state, deliberately *not* in `map-store.ts`: an unfinished
 * draft is UI, not map state, and no tool should be able to see or steer it.
 * Only the finished shape crosses over, through `addDrawing`.
 *
 * MapCanvas subscribes to this imperatively (it must not re-render), the
 * toolbar reads it with the hook - the same split the map/store sync uses.
 */
interface DrawStore {
  mode: DrawMode;
  /** Vertices clicked so far, in order. Empty unless mode is "polygon". */
  draft: LngLat[];
  /** The walk's two ends as they are clicked, 0-2. Empty unless mode is "route". */
  routeDraft: LngLat[];
  /** Whether a walk is being planned, or why the last one was not. */
  routeStatus: RouteStatus;
  /**
   * Once a person has really planned a walk here, this page owes the routing
   * service its credit for the rest of the session — the same latch, and the
   * same reasoning, as `route-credit.ts`, which cannot see this one because a
   * hand-planned walk is not a tool call and writes no activity row.
   */
  routeCredited: boolean;
  start: () => void;
  startRoute: () => void;
  cancel: () => void;
  addVertex: (vertex: LngLat) => void;
  /** A click in route mode: the start, or the end (which plans the walk). */
  addRouteVertex: (vertex: LngLat) => Promise<void>;
  /** Stores the draft as a user drawing; null (and no state change) if it has fewer than three corners. */
  finish: () => Drawing | null;
}

export const useDrawStore = create<DrawStore>((set, get) => ({
  mode: "none",
  draft: [],
  routeDraft: [],
  routeStatus: "idle",
  routeCredited: false,
  // Each of the three ways into or out of a mode drops whatever the other mode
  // was holding: the two gestures share the map's clicks, so leaving one has to
  // leave nothing of it behind for the next click to be read against.
  start: () => {
    planTicket += 1;
    set({ mode: "polygon", draft: [], routeDraft: [], routeStatus: "idle" });
  },
  startRoute: () => {
    planTicket += 1;
    set({ mode: "route", draft: [], routeDraft: [], routeStatus: "idle" });
  },
  cancel: () => {
    planTicket += 1;
    set({ mode: "none", draft: [], routeDraft: [], routeStatus: "idle" });
  },
  addVertex: (vertex) => set((s) => ({ draft: [...s.draft, roundVertex(vertex)] })),
  addRouteVertex: async (vertex) => {
    const state = get();
    if (state.mode !== "route" || state.routeStatus === "planning") return;
    const at = roundVertex(vertex);
    const from = state.routeDraft[0];
    if (!from) {
      set({ routeDraft: [at], routeStatus: "idle" });
      return;
    }
    // Both ends inside the same metre is not a walk, and asking the service for
    // one would spend a request to be told so. The start stays put, and the
    // hint says what is still missing.
    if (samePoint(from, at)) {
      set({ routeStatus: { error: "That is where the walk starts" } });
      return;
    }

    const ticket = (planTicket += 1);
    set({ routeDraft: [from, at], routeStatus: "planning" });
    const walk = await planWalk(from, at, routeFetch);
    // Cancelled, restarted or switched away while the service was answering.
    if (ticket !== planTicket) return;

    if ("error" in walk) {
      // The service's own sentence, kept whole: it is already plain English and
      // it already says that nothing was drawn. The start goes with it, so the
      // next click is a new one rather than a retry of the same failed pair.
      set({ routeDraft: [], routeStatus: { error: walk.error } });
      return;
    }

    const drawing = useMapStore.getState().addDrawing({
      source: "user",
      kind: "line",
      label: routeLabel(walk.distance_m, walk.duration_s),
      geometry: { type: "LineString", coordinates: walk.coordinates },
    });
    set({ mode: "none", routeDraft: [], routeStatus: "idle", routeCredited: true });
    // A person just planned a walk. Announced here for the same reason a
    // finished polygon is: see `finish`.
    emitHumanFx({ type: "draw", drawing });
  },
  finish: () => {
    const geometry = polygonFromVertices(get().draft);
    if (!geometry) return null;
    const drawing = useMapStore
      .getState()
      .addDrawing({ source: "user", kind: "polygon", geometry });
    set({ mode: "none", draft: [] });
    // A person just inked a shape. Announced here rather than diffed out of
    // the store, so restoring a share link's shapes never replays as a gesture.
    emitHumanFx({ type: "draw", drawing });
    return drawing;
  },
}));
