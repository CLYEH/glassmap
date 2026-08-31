/**
 * The routing credit is a licence condition, not a nicety: FOSSGIS asks for
 * attribution in exchange for the walking routes `plan_route` fetches. So these
 * tests are about the two ways a page could stop showing it — the drawing going
 * away, and the feed forgetting the call — and about not showing it for work
 * that never happened.
 *
 * The first case runs the real tool through the real activity recorder, with
 * the service injected, rather than hand-writing a row: what has to hold is
 * that a *successful `plan_route` call on this page* lights the credit, and a
 * hand-written row could go on satisfying that after the tool layer stopped
 * producing it.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "@/lib/map-tools";
import { resetRouteThrottle } from "@/lib/map-tools/route";
import {
  FIXTURE_FEATURES,
  VIEW,
  VIEW_BOUNDS,
  createRouteFetch,
} from "@/lib/map-tools/test-fixtures";
import { createMemoryToolStore, type MemoryToolStore } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { createRoutingCredit, routingUsed } from "./route-credit";

const signal = new AbortController().signal;

/** The whole tool layer over a memory store, with a routing service that answers. */
function page(answer?: Parameters<typeof createRouteFetch>[0]) {
  const { routeFetch } = createRouteFetch(answer);
  const store: MemoryToolStore = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
  });
  resetRouteThrottle();
  const byName = Object.fromEntries(createMapTools(store, { routeFetch }).map((t) => [t.name, t]));
  return { store, byName };
}

const call = (tool: GlassMapTool, input: Record<string, unknown> = {}) =>
  tool.execute(input, { signal });

describe("crediting the routing service", () => {
  it("is owed once a real plan_route call has answered on this page", async () => {
    const { store, byName } = page();
    const credit = createRoutingCredit();
    expect(credit(store.getActivity())).toBe(false);

    await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });

    expect(store.getActivity().at(-1)).toMatchObject({ tool: "plan_route", ok: true });
    expect(credit(store.getActivity())).toBe(true);
  });

  it("is not owed for a walk the service refused to plan", async () => {
    // Nothing was fetched into the map and nothing was drawn: the answer is an
    // error, which `describeCall` records as `ok: false`. Crediting FOSSGIS
    // here would credit them for work nobody did.
    const { store, byName } = page(() => ({ code: "NoRoute" }));
    const result = (await call(byName.plan_route, {
      from: "osm:node:2",
      to: "osm:node:1",
    })) as { error?: string };

    expect(result.error).toBeTruthy();
    expect(store.getActivity().at(-1)).toMatchObject({ tool: "plan_route", ok: false });
    expect(createRoutingCredit()(store.getActivity())).toBe(false);
  });

  it("is not owed by a page that has only used the offline tools", async () => {
    const { store, byName } = page();
    await call(byName.get_map_state);
    await call(byName.draw_shape, { type: "circle", center: { lng: 121.5436, lat: 25.0334 } });
    expect(routingUsed(store.getActivity())).toBe(false);
  });

  it("stays owed after the row that earned it has left the feed", async () => {
    // The feed is capped (ACTIVITY_LIMIT) and is not a log. A credit derived
    // live from it would quietly disappear on a busy session, which is the one
    // failure mode that turns a rendering decision into a licence breach.
    const credit = createRoutingCredit();
    expect(credit([{ tool: "plan_route", ok: true }])).toBe(true);
    expect(credit([])).toBe(true);
  });

  it("stays owed after the route drawing is removed from the map", async () => {
    // `remove_from_map` takes the line off; it does not take back the request
    // that was made to somebody else's server to produce it.
    const { store, byName } = page();
    const credit = createRoutingCredit();
    const planned = (await call(byName.plan_route, {
      from: "osm:node:2",
      to: "osm:node:1",
    })) as { drawing_id?: string };
    expect(credit(store.getActivity())).toBe(true);

    await call(byName.remove_from_map, { ids: [planned.drawing_id] });

    expect(store.getDrawings()).toHaveLength(0);
    expect(credit(store.getActivity())).toBe(true);
  });
});
