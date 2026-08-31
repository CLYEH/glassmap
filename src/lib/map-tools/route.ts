/**
 * plan_route's engine: a walking route from the public OSRM service, turned
 * into a line this map can draw.
 *
 * This is the only place in the app that talks to a server at request time —
 * everything else answers from `public/data`. Three things follow from that,
 * and they are the whole reason this module exists apart from the tool:
 *
 *  - **The service is somebody else's.** `routing.openstreetmap.de` is run by
 *    FOSSGIS (the German OpenStreetMap chapter) and its usage policy asks for
 *    at most one request per second and for attribution. The rate limit is
 *    enforced here, in one module-level queue, because the limit belongs to the
 *    page and not to a `createMapTools` instance: the app and the dev shim can
 *    both hold tools, and two of them firing at once would still be two
 *    requests in the same second.
 *  - **It can fail, and a route is not something to guess.** Every failure —
 *    a `code` other than "Ok" (which OSRM sends with HTTP 200), a dead network,
 *    a timeout, an answer this map cannot read — comes back as one plain
 *    sentence for the agent to relay. Nothing here ever invents a line.
 *  - **What comes back is bigger than the map wants.** `overview=full` returns
 *    every shape point (a 3.8 km Taipei walk is 181 of them), so a long route
 *    is simplified down to the same ceiling draw_shape holds an agent to.
 *
 * Like the rest of the tool layer, nothing in here throws: bad input and bad
 * answers are `{ error }`.
 */
import { simplify } from "@turf/turf";
import type { Feature, LineString, Position } from "geojson";
import type { LngLat } from "@/lib/store/map-store";
import { MAX_LABEL_CHARS, MAX_SHAPE_POINTS, validatePosition } from "./shapes";
import { round5 } from "./state";

/**
 * The foot profile of FOSSGIS' OSRM deployment. "driving" is not a mistake: it
 * is OSRM's fixed profile slot in the URL, and which profile actually runs is
 * decided by the `routed-foot` service in front of it.
 */
export const ROUTE_SERVICE_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";

/**
 * Whose route this is. FOSSGIS' policy asks for attribution, and the agent is
 * the one reading the answer out to the human, so it travels in the answer.
 */
export const ROUTE_ATTRIBUTION =
  "Walking route by the FOSSGIS OSRM service, data © OpenStreetMap contributors";

/**
 * How long the service gets before the call is a failure. A tool call that
 * never returns is the one failure an agent can neither report nor retry — it
 * just looks like the agent stopped answering — and this is a request for a
 * few kilobytes, not the 2.5 MB a tier-2 category can be.
 */
export const ROUTE_TIMEOUT_MS = 8_000;

/** FOSSGIS' published limit: at most one request per second, per user. */
export const ROUTE_MIN_INTERVAL_MS = 1_000;

/** Injected so tests never touch the network; the same shape as `FetchJson`. */
export type RouteFetch = (url: string) => Promise<unknown>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const rec = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const fin = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export function routeUrl(from: LngLat, to: LngLat): string {
  // Coordinates go out exactly as the tool resolved and echoes them, so the
  // line that comes back starts where the answer says the walk starts.
  return (
    `${ROUTE_SERVICE_URL}/${from[0]},${from[1]};${to[0]},${to[1]}` +
    "?overview=full&geometries=geojson&steps=false"
  );
}

/** Browser fetch; the status is folded into the message, as tier-2's does. */
export const httpRouteFetch: RouteFetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as unknown;
};

// ------------------------------------------------------------------- throttle

/**
 * When the next request may leave, as epoch ms. Module level on purpose: see
 * the header — the second belongs to the page, not to a tools instance.
 */
let nextSlotAt = 0;

/**
 * Waits until this call's turn, then returns. It never refuses and it never
 * fires early: a call arriving inside the second waits out the remainder.
 *
 * The slot is taken synchronously, before the first `await`, so two calls made
 * in the same tick leave in the order they were made rather than racing for
 * the same second. Slots are counted from when a request *starts*, not when it
 * finishes: the policy is about how often we ask, and a slow answer must not
 * make the next caller wait for it as well.
 */
export async function reserveRouteSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlotAt);
  nextSlotAt = at + ROUTE_MIN_INTERVAL_MS;
  if (at > now) await new Promise<void>((resolve) => setTimeout(resolve, at - now));
}

/** Tests only: forget the last request, so a suite is not paced by the policy. */
export function resetRouteThrottle(): void {
  nextSlotAt = 0;
}

// -------------------------------------------------------------------- parsing

/**
 * The two OSRM statuses a walking question can genuinely produce, in words the
 * agent can hand to a human. Anything else is quoted as it came: an unknown
 * status invented here would be a guess about somebody else's service.
 */
const CODE_REASONS: Record<string, string> = {
  NoRoute: "there is no walking route between these two points",
  NoSegment: "one of the two points is too far from any street the service knows",
};

export interface ParsedRoute {
  /** Metres, as the service measured them — not the drawn line's length. */
  distance: number;
  /** Seconds, at the service's walking pace. */
  duration: number;
  coordinates: Position[];
}

/**
 * The service's answer, or why it is not one. OSRM reports its own failures
 * with HTTP 200 and a `code`, so the status line proves nothing and this is
 * where a refusal is actually detected.
 */
export function parseRoute(payload: unknown): ParsedRoute | { error: string } {
  const body = rec(payload);
  if (!body) return { error: "it answered something this map cannot read" };

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code !== "Ok") {
    const reason =
      CODE_REASONS[code] ?? (code ? `the service answered "${code}"` : "the service answered with no status");
    const detail = typeof body.message === "string" && body.message.trim() ? ` (${body.message.trim()})` : "";
    return { error: `${reason}${detail}` };
  }

  const route = rec(Array.isArray(body.routes) ? body.routes[0] : undefined);
  if (!route) return { error: 'it answered "Ok" with no route in it' };

  const distance = fin(route.distance);
  const duration = fin(route.duration);
  // Measuring the line ourselves and calling the number the service's would be
  // a different claim than the one the agent reads out; refuse instead.
  if (distance === undefined || duration === undefined) {
    return { error: "its route came back without a distance or a duration" };
  }

  const geometry = rec(route.geometry);
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return { error: "its route came back without a line to draw" };
  }
  const coordinates: Position[] = [];
  for (const raw of geometry.coordinates) {
    // The same definition of a valid [lng, lat] the agent's own coordinates
    // are held to; one bad point makes the whole line unusable.
    const point = validatePosition(raw, "the route");
    if ("error" in point) return { error: "its route line has a point that is not a coordinate" };
    coordinates.push(point.point);
  }
  if (coordinates.length < 2) return { error: "its route line has fewer than two points" };

  return { distance, duration, coordinates };
}

// ------------------------------------------------------------------ geometry

/** ~1 m in degrees: the finest simplification worth trying on a street. */
const SIMPLIFY_START_TOLERANCE = 1e-5;

/**
 * How many times the tolerance may double. The last one is ~10 degrees, which
 * flattens any route on earth to its two ends, so the loop cannot run out
 * without having fitted first.
 */
const SIMPLIFY_STEPS = 20;

/**
 * Every n-th point, ends kept. The guard behind the simplifier: turf on
 * geometry it does not like must not leave the store holding a line the map
 * has to redraw on every frame. Coarser than Ramer-Douglas-Peucker — it rounds
 * off exactly the corners a walking route is made of — which is why it is the
 * fallback and not the method.
 */
export function decimateRoutePoints(coordinates: Position[]): Position[] {
  if (coordinates.length <= MAX_SHAPE_POINTS) return coordinates;
  const step = Math.ceil(coordinates.length / (MAX_SHAPE_POINTS - 1));
  const kept = coordinates.filter((_p, i) => i % step === 0);
  const last = coordinates[coordinates.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/**
 * A line the map can hold: at most MAX_SHAPE_POINTS points, each rounded to the
 * five decimals every other coordinate in this layer carries.
 *
 * Ramer-Douglas-Peucker (turf's `simplify`) rather than dropping points at a
 * fixed interval, because what matters on a walking route is where it turns:
 * decimation would round the corner onto a lane and leave the straight
 * stretches over-sampled. RDP takes a tolerance and not a target count, so the
 * tolerance is doubled until the line fits — and it keeps the first and last
 * points, so a simplified route still starts and ends where the walk does.
 */
export function toDrawableLine(coordinates: Position[]): {
  coordinates: Position[];
  simplified: boolean;
} {
  const fitted = fitToShapePoints(coordinates);
  return {
    coordinates: fitted.map((p) => [round5(p[0]), round5(p[1])]),
    simplified: fitted !== coordinates,
  };
}

function fitToShapePoints(coordinates: Position[]): Position[] {
  if (coordinates.length <= MAX_SHAPE_POINTS) return coordinates;
  try {
    let tolerance = SIMPLIFY_START_TOLERANCE;
    for (let i = 0; i < SIMPLIFY_STEPS; i += 1) {
      const line: Feature<LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      };
      const out = simplify(line, { tolerance }).geometry.coordinates;
      if (out.length <= MAX_SHAPE_POINTS) return out;
      tolerance *= 2;
    }
  } catch {
    // Unusable geometry costs the route its detail, not its whole answer.
  }
  return decimateRoutePoints(coordinates);
}

// --------------------------------------------------------------------- label

/** What a walk is called when it cannot be named after its two ends. */
export const DEFAULT_ROUTE_LABEL = "walking route";

/**
 * "walk: 大安 → 台北車站" — the two places as the layer resolved them, which is
 * the same name compare_areas and describe_surroundings echo. A coordinate
 * resolves to no name at all, and a pair of names too long for the label cap
 * falls back rather than being cut: a label ending mid-destination would put a
 * different walk on the map than the one that was drawn.
 */
export function defaultRouteLabel(from?: string, to?: string): string {
  if (!from || !to) return DEFAULT_ROUTE_LABEL;
  const label = `walk: ${from} → ${to}`;
  return label.length <= MAX_LABEL_CHARS ? label : DEFAULT_ROUTE_LABEL;
}

// ---------------------------------------------------------------------- plan

export interface PlannedWalk {
  /** Whole metres, the service's own figure. */
  distance_m: number;
  /** Whole seconds, the service's own figure. */
  duration_s: number;
  /** Ready to store: rounded, and inside MAX_SHAPE_POINTS. */
  coordinates: Position[];
  /** True when the drawn line has fewer points than the service sent. */
  simplified: boolean;
}

/**
 * Every refusal reads the same way round: what went wrong, then the one thing
 * the agent has to know before it answers the human — that there is nothing on
 * the map to look at.
 */
const unchanged = (reason: string) => `${reason}. Nothing was drawn and the map is unchanged`;

/**
 * One walk, or one sentence saying why there is none. Waits for its turn under
 * the rate limit first, so a queued call is late rather than refused.
 */
export async function planWalk(
  from: LngLat,
  to: LngLat,
  routeFetch: RouteFetch,
): Promise<PlannedWalk | { error: string }> {
  await reserveRouteSlot();

  let payload: unknown;
  try {
    payload = await routeFetch(routeUrl(from, to));
  } catch (e) {
    // A timeout is worth telling apart from a refusal: asking again may work,
    // and the agent is the one deciding whether to.
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return {
      error: unchanged(
        `the routing service could not be reached: ${
          timedOut ? `no answer after ${ROUTE_TIMEOUT_MS / 1000}s` : message(e)
        }`,
      ),
    };
  }

  const parsed = parseRoute(payload);
  if ("error" in parsed) {
    return { error: unchanged(`the routing service could not plan this walk: ${parsed.error}`) };
  }

  return {
    distance_m: Math.round(parsed.distance),
    duration_s: Math.round(parsed.duration),
    ...toDrawableLine(parsed.coordinates),
  };
}
