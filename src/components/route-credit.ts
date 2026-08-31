/**
 * When this page owes the routing service a credit on screen.
 *
 * `plan_route` is the one tool that asks somebody else's server a question
 * (`lib/map-tools/route.ts`): walking routes come from the OSRM deployment
 * FOSSGIS runs at routing.openstreetmap.de, whose usage policy asks for
 * attribution as well as for the one-request-per-second the tool layer already
 * honours. The tool returns that credit to the agent in every successful answer
 * (`ROUTE_ATTRIBUTION`), and an agent relaying it to a human is not something
 * this page can rely on — so the page says it itself, in the corner where the
 * basemap's credits already are.
 *
 * Two rules, and both are about erring towards saying it:
 *
 *  - **A latch, not a query.** Once a route has been planned here the credit
 *    stays for the rest of the session, whatever happens to the drawing
 *    afterwards. `remove_from_map` can take the line off, and the feed itself
 *    is capped at ACTIVITY_LIMIT rows, so anything derived live from the store
 *    would eventually stop crediting a service this page did use. Crediting a
 *    service for longer than strictly necessary costs a line of 10px text;
 *    under-crediting is a licence problem.
 *  - **A successful call, not any call.** A refused `plan_route` never reached
 *    the service with an answer to show (`describeCall` records `ok: false` for
 *    every error the tool returns), and nothing was drawn. Crediting FOSSGIS
 *    for a walk it declined to plan would be a claim about work nobody did.
 */

/** The tool whose answers this credit is about. */
export const ROUTING_TOOL = "plan_route";

/**
 * The slice of an activity row this decision reads. `ActivityEntry` satisfies
 * it structurally, so the real feed flows straight in.
 */
export interface RoutingCall {
  tool: string;
  ok: boolean;
}

/** True once a `plan_route` call in this list actually returned a route. */
export function routingUsed(activity: readonly RoutingCall[]): boolean {
  return activity.some((entry) => entry.tool === ROUTING_TOOL && entry.ok);
}

/**
 * The session latch: ask it on every render, and it only ever goes from false
 * to true. One per page — the component that renders the credit owns it.
 */
export function createRoutingCredit(): (activity: readonly RoutingCall[]) => boolean {
  let credited = false;
  return (activity) => {
    if (!credited && routingUsed(activity)) credited = true;
    return credited;
  };
}
