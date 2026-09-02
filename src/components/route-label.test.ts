/**
 * The label a hand-planned walk carries is the only place on the map where its
 * two numbers appear — there is no tool answer beside it and no feed row about
 * it, because a person clicking two points makes neither. So these tests are
 * about the two ways a number can lie: precision it does not have, and a
 * duration that reads shorter than it is.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE_LABEL } from "@/lib/map-tools/route";
import { MAX_LABEL_CHARS } from "@/lib/map-tools/shapes";
import { formatRouteDistance, formatRouteDuration, routeLabel } from "./route-label";

describe("route label", () => {
  it("says a short walk in metres and a longer one in kilometres", () => {
    // The precision a walk is decided by: below a kilometre a person counts
    // metres, above it they do not.
    expect(formatRouteDistance(850)).toBe("850 m");
    expect(formatRouteDistance(999.4)).toBe("999 m");
    expect(formatRouteDistance(1000)).toBe("1.0 km");
    expect(formatRouteDistance(1234)).toBe("1.2 km");
  });

  it("drops the decimal once the walk is long enough for it to be noise", () => {
    expect(formatRouteDistance(9999)).toBe("10.0 km");
    expect(formatRouteDistance(12345)).toBe("12 km");
  });

  it("never rounds a duration down", () => {
    // Rounding 61 seconds to "1 min" tells a person they have time they do not
    // have. Up is the only safe direction for a number somebody leaves by.
    expect(formatRouteDuration(61)).toBe("2 min");
    expect(formatRouteDuration(120)).toBe("2 min");
    expect(formatRouteDuration(121)).toBe("3 min");
  });

  it("reads as one line naming the walk, its length and its time", () => {
    expect(routeLabel(1234, 940)).toBe("walking route · 1.2 km · 16 min");
    expect(routeLabel(850, 620)).toBe("walking route · 850 m · 11 min");
  });

  it("cannot outgrow the cap every other drawing label is held to", () => {
    // Why `routeLabel` has no fallback where `defaultRouteLabel` does: two
    // numbers, however absurd the service's answer, cannot reach 80 characters.
    // If the format ever could, this is the test that says so first.
    const widest = routeLabel(Number.MAX_VALUE, Number.MAX_VALUE);
    expect(widest.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(routeLabel(3830, 2761).length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(widest.startsWith(DEFAULT_ROUTE_LABEL)).toBe(true);
  });
});
