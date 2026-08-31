/**
 * The two component modules whose maths moved into `lib/geo` for T-102 still
 * hand out exactly what they handed out before.
 *
 * `components/frame-model.ts` and `components/viewport-bounds.ts` are imported
 * by `Inspector.tsx` and `MapCanvas.tsx` and were the only home of this maths
 * until `set_map_view({fit})` needed it too. The move was supposed to be
 * invisible on that side, and "supposed to be" is not a guarantee: a re-export
 * list is hand-written, so it can quietly lose a name, and — worse — it can
 * re-export a *different* implementation and every existing test would still
 * pass because each side would be internally consistent.
 *
 * So this compares function identity, not behaviour: the human's row click and
 * the agent's fit must be the same object in memory, or "the two paths cannot
 * disagree" is a claim nothing holds up. It is also the test that fails if
 * someone later reintroduces a local copy in `components/` "just for the UI".
 */
import { describe, expect, it } from "vitest";
import * as frameModel from "@/components/frame-model";
import * as viewportBounds from "@/components/viewport-bounds";
import * as frame from "./frame";
import * as mercator from "./mercator";

describe("components re-export the relocated maths, unchanged", () => {
  it("hands out lib/geo/frame itself, under every name T-101 imports", () => {
    // The whole public surface of the module as T-101 left it. Listed
    // explicitly rather than derived from either side, so deleting an export
    // from both at once still fails here.
    const surface = [
      "ROW_POINT_ZOOM",
      "ROW_FIT_FILL",
      "ROW_FIT_MAX_ZOOM",
      "ROW_FIT_MIN_ZOOM",
      "geometryBounds",
      "boundsCenter",
      "hasExtent",
      "frameFor",
      "frameForPoint",
    ] as const;

    for (const name of surface) {
      expect(frameModel[name], name).toBe(frame[name]);
    }
    expect(Object.keys(frameModel).sort()).toEqual([...surface].sort());
  });

  it("hands out lib/geo/mercator itself, and keeps visibleBounds to itself", () => {
    expect(viewportBounds.approximateBounds).toBe(mercator.approximateBounds);
    expect(viewportBounds.zoomToFit).toBe(mercator.zoomToFit);
    // `visibleBounds` reads a live map's `unproject`; it stayed in the
    // component layer on purpose and must not have followed the maths down.
    expect("visibleBounds" in mercator).toBe(false);
    expect(typeof viewportBounds.visibleBounds).toBe("function");
  });
});
