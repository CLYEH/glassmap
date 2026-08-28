/**
 * The two guards that stand between the map and the address bar.
 *
 * `useShareHash` writes the map into `location.hash` on every change, which
 * means it runs on every gesture on a page that never reloads. Both ways of
 * getting that wrong are user-visible and neither shows up as an exception:
 *
 *  1. Writing when nothing changed. The map reports its own camera back to the
 *     store after every `moveend` (MapCanvas's `pushViewFromMap`), so a plan
 *     that cannot tell "the same map again" from "a new map" rewrites the URL
 *     forever. The codec's byte-identical re-encode is what makes the cheap
 *     string comparison sound; these tests are what notice if that stops being
 *     true.
 *  2. Writing a link that is too long to survive. `get_share_link` refuses to
 *     hand out a URL over `MAX_SHARE_URL_BYTES`; if the address bar keeps
 *     filling up past that, the human copies out of it the exact link the tool
 *     declined to give them.
 */
import { describe, expect, it } from "vitest";
import { decodeShareState, encodeShareState, MAX_SHARE_URL_BYTES } from "@/lib/map-tools/share";
import type { ShareState } from "@/lib/map-tools/share";
import { DEFAULT_VIEW, type MapView } from "@/lib/store/map-store";
import { planHashUpdate } from "./share-hash";

const BASE = "http://localhost:3000/";

const state = (patch: Partial<ShareState> = {}): ShareState => ({
  view: DEFAULT_VIEW,
  selection: [],
  drawings: [],
  annotations: [],
  ...patch,
});

const view = (patch: Partial<MapView>): MapView => ({ ...DEFAULT_VIEW, ...patch });

/** A ring of `points` corners around Taipei, closed as GeoJSON requires. */
function bigRing(points: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points;
    ring.push([121.5175 + 0.05 * Math.cos(angle), 25.0478 + 0.05 * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

const polygon = (points: number): ShareState["drawings"][number] => ({
  source: "user",
  kind: "polygon",
  geometry: { type: "Polygon", coordinates: [bigRing(points)] },
});

describe("planHashUpdate", () => {
  it("plans no write when the map is the one the fragment already describes", () => {
    // The exact case MapCanvas produces on every pan: a new `view` object with
    // the same numbers in it. Nothing about the map changed, so the history
    // entry must not be touched.
    const current = state({ selection: ["mrt:1"] });
    const plan = planHashUpdate(current, BASE, `#${encodeShareState(current)}`);
    expect(plan.hash).toBeNull();
    expect(plan.tooLarge).toBe(false);
  });

  it("compares the fragment with or without its leading #", () => {
    // `location.hash` carries the "#", `encodeShareState` does not. Comparing
    // the two raw would make every single change look like a change.
    const current = state();
    expect(planHashUpdate(current, BASE, encodeShareState(current)).hash).toBeNull();
  });

  it("plans a write when the camera moved, and the fragment restores where to", () => {
    const before = state();
    const after = state({ view: view({ center: [121.6, 25.1], zoom: 15.5 }) });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    const decoded = decodeShareState(plan.hash!);
    expect("error" in decoded).toBe(false);
    expect((decoded as { view: MapView }).view.center).toEqual([121.6, 25.1]);
  });

  it("plans a write when only the selection changed", () => {
    // The camera is the loudest part of the state but not the only shareable
    // one: a link that always carried the map the human is looking at and never
    // what they had picked out on it would be a worse link than none.
    const before = state();
    const after = state({ selection: ["mrt:zhongshan"] });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    const decoded = decodeShareState(plan.hash!);
    expect((decoded as { selection: string[] }).selection).toEqual(["mrt:zhongshan"]);
  });

  it("plans a write when only a drawing was added", () => {
    const before = state();
    const after = state({ drawings: [polygon(5)] });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    expect((decodeShareState(plan.hash!) as { drawings: unknown[] }).drawings).toHaveLength(1);
  });

  it("stops writing once the map outgrows a URL, rather than writing a truncated one", () => {
    const huge = state({ drawings: [polygon(500)] });
    const plan = planHashUpdate(huge, BASE, "#v1.previous");
    expect(plan.bytes).toBeGreaterThan(MAX_SHARE_URL_BYTES);
    expect(plan.tooLarge).toBe(true);
    // Null, not the over-long fragment: whatever is in the address bar restores
    // a real map, and it is better than half of this one.
    expect(plan.hash).toBeNull();
  });

  it("resumes writing once the map fits again", () => {
    // The overflow is a property of the current map, not a latch: deleting the
    // shape that broke the link has to give the link back.
    const plan = planHashUpdate(state({ drawings: [polygon(4)] }), BASE, "#v1.previous");
    expect(plan.tooLarge).toBe(false);
    expect(plan.hash).not.toBeNull();
  });

  it("counts the whole URL, not just the fragment", () => {
    // The limit is on what gets pasted into a chat window, and the origin and
    // path are part of that. The same map is shareable from a short URL and not
    // from a long one, so the budget cannot be measured on the hash alone.
    const current = state({ drawings: [polygon(40)] });
    const short = planHashUpdate(current, BASE, "");
    expect(short.tooLarge).toBe(false);

    const overshoot = MAX_SHARE_URL_BYTES - short.bytes + 1;
    const long = planHashUpdate(current, BASE + "p".repeat(overshoot), "");
    expect(long.tooLarge).toBe(true);
    expect(long.hash).toBeNull();
  });
});
