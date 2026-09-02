/**
 * What a walk a person clicked out is called on the map.
 *
 * `plan_route` names an agent's route after its two ends — "walk: 大安 → 台北
 * 車站" — because the agent asked for places and the tool layer resolved them
 * to names. A person clicks two points on the map instead, and a point has no
 * name: there is nothing to build that label out of, and inventing one (the
 * nearest street, the nearest station) would put a claim on the map that
 * nobody made.
 *
 * So the label says the two things the service did answer, and they are the
 * two a person reading the map wants anyway: how far the walk is and how long
 * it takes. Both are the service's own figures, never measured off the drawn
 * line — the line is simplified to fit the map (`route.ts`), so measuring it
 * would quietly disagree with the number.
 *
 * Rounding is deliberately coarse and deliberately one-sided:
 *
 *  - Distance in whole metres below a kilometre, one decimal below ten, whole
 *    kilometres above — the precision a walk is actually decided by. "850 m"
 *    and "1.2 km" are answers; "849.7 m" is noise.
 *  - Duration always **up** to the next minute. A walk that takes 61 seconds
 *    is "2 min", not "1 min": rounding a duration down tells a person they
 *    have time they do not have.
 */
import { DEFAULT_ROUTE_LABEL } from "@/lib/map-tools/route";

/** How far the walk is, as a person would say it. */
export function formatRouteDistance(distance_m: number): string {
  if (distance_m < 1000) return `${Math.round(distance_m)} m`;
  const km = distance_m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** How long it takes, never rounded down. */
export function formatRouteDuration(duration_s: number): string {
  return `${Math.ceil(duration_s / 60)} min`;
}

/**
 * "walking route · 1.2 km · 16 min".
 *
 * No length fallback, unlike `defaultRouteLabel`, which drops a pair of
 * over-long *place names* rather than cut one in half: two numbers cannot get
 * that long. The widest this can render is 72 characters — both figures at
 * Number.MAX_VALUE, where JavaScript switches to exponent notation — against
 * the 80 every drawing label is held to (`MAX_LABEL_CHARS`), and the numbers
 * themselves are the service's own finite metres and seconds. The test holds
 * that ceiling, so a change to the format is what would have to justify a
 * fallback, not a call site.
 */
export function routeLabel(distance_m: number, duration_s: number): string {
  return `${DEFAULT_ROUTE_LABEL} · ${formatRouteDistance(distance_m)} · ${formatRouteDuration(duration_s)}`;
}
