"use client";

import { Fragment, useSyncExternalStore } from "react";
import { ROUTE_ATTRIBUTION } from "@/lib/map-tools/route";
import { useMapStore } from "@/lib/store/map-store";
import { useDrawStore } from "./draw-store";
import { STYLE_ATTRIBUTION } from "./map-style";
import { createRoutingCredit } from "./route-credit";

/**
 * The routing credit's session latch, and the store subscription that tells
 * React when to look again.
 *
 * `useSyncExternalStore` rather than an effect for the reason `AgentWhisper`
 * gives: the React 19 rules this repo lints against forbid the setState-in-an-
 * effect the naive version needs, and the server has no store to read. The
 * snapshot is monotonic (`route-credit.ts`), so React sees exactly one change —
 * false to true, the first time a route is planned — and the server snapshot is
 * always false, because a page that has served no tool call and drawn no walk
 * by hand has used no routing service. A restored share link never writes
 * `activity` either (see `badge-claim.ts`), so hydration cannot disagree with
 * it.
 */
const readCredit = createRoutingCredit();

/**
 * Two ways to owe the credit, because there are two ways to use the service.
 * An agent's `plan_route` leaves an activity row; a person clicking two points
 * on the map leaves none — a hand gesture is not agent activity and the feed
 * must not claim it was (`fx/human-events.ts`) — so the human half carries its
 * own latch in `draw-store.ts`. Both are monotonic, so the combined snapshot
 * still changes at most once, which is what `useSyncExternalStore` needs.
 */
const subscribeToCalls = (onChange: () => void) => {
  const unsubscribeCalls = useMapStore.subscribe((state, previous) => {
    if (state.activity !== previous.activity) onChange();
  });
  const unsubscribeHand = useDrawStore.subscribe((state, previous) => {
    if (state.routeCredited !== previous.routeCredited) onChange();
  });
  return () => {
    unsubscribeCalls();
    unsubscribeHand();
  };
};

const creditSnapshot = () =>
  readCredit(useMapStore.getState().activity) || useDrawStore.getState().routeCredited;

/**
 * The basemap's licence attribution, with its links. Not decoration and not
 * optional: OpenFreeMap, OpenMapTiles and OpenStreetMap each require the
 * credit, and OSM's requires it to be a working link to the copyright page.
 *
 * It is ours to render rather than MapLibre's because the built-in control
 * lives in the map's bottom-right corner, which the inspector covers at every
 * desktop width; the text itself is `STYLE_ATTRIBUTION`, kept beside the style
 * URL it belongs to.
 *
 * Above it, once and only once a walking route has really been planned here —
 * by an agent's tool call or by a person clicking its two ends (T-110) —
 * sits the second credit this page can owe: the routing service's. It is a
 * sibling line in the same corner rather than a banner — the same 10px glass,
 * the same right edge — because it is the same kind of statement about where
 * this map's data comes from.
 */
export function Attribution() {
  const credited = useSyncExternalStore(subscribeToCalls, creditSnapshot, () => false);

  return (
    <>
      {credited ? (
        <span className="attribution routing" data-testid="route-attribution">
          {/* Verbatim the string the tool hands the agent, so the human's
              screen and the agent's answer credit the service in exactly the
              same words. OpenStreetMap's own copyright link is one line below,
              in the basemap credit, which is always on screen. */}
          {ROUTE_ATTRIBUTION}
        </span>
      ) : null}
      <span className="attribution" data-testid="attribution">
        {STYLE_ATTRIBUTION.map((item, index) => (
          <Fragment key={item.href}>
            {index > 0 ? " " : null}
            {"prefix" in item ? item.prefix : null}
            <a href={item.href} target="_blank" rel="noopener noreferrer">
              {item.text}
            </a>
          </Fragment>
        ))}
      </span>
    </>
  );
}
