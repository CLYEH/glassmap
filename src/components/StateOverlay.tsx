"use client";

import { describeView, round5 } from "@/lib/map-tools/state";
import { useMapStore } from "@/lib/store/map-store";

/**
 * The store as text, at full precision: every value a tool can change, with a
 * `data-testid` a test can read without touching the canvas.
 *
 * The design gives each of these a home in the chrome — the camera in the
 * camera chip, the counts in the legend and the inspector's section pills —
 * but rounded and worded for a person ("z12", "2,063 places"). This block
 * keeps the exact numbers a tool returned, so an assertion about a tool's
 * effect never has to be written against a human sentence.
 *
 * It is off screen, not `display: none` and not deleted: `bounds`, `bearing`
 * and `pitch` appear nowhere in the design, and a headless run with no WebGL
 * still has to be able to prove the store moved.
 */
export function StateOverlay() {
  const view = useMapStore((s) => s.view);
  const bounds = useMapStore((s) => s.bounds);
  // Everything queryable, which is exactly what `get_map_state` reports as
  // `features_loaded` (describeState -> store.getFeatures().length = the
  // bundled datasets plus every loaded tier-2 category). Counting only
  // `features` left the machine mirror and the agent's own answer disagreeing
  // from the first POI load onwards — the one thing this block exists to make
  // impossible. Ids never overlap: the store drops a tier-2 feature whose id a
  // bundled dataset already has (`appendTier2Features`), so the sum is exact.
  const featureCount = useMapStore((s) => s.features.length + s.tier2Features.length);
  const selectionCount = useMapStore((s) => s.selection.length);
  const drawingCount = useMapStore((s) => s.drawings.length);
  const annotationCount = useMapStore((s) => s.annotations.length);
  const state = describeView(view);

  return (
    <div data-testid="state-overlay" className="gm-machine" aria-hidden>
      <dl>
        <dt>center</dt>
        <dd data-testid="center">
          {state.center.lng}, {state.center.lat}
        </dd>
        <dt>zoom</dt>
        <dd data-testid="zoom">{state.zoom}</dd>
        <dt>bearing</dt>
        <dd data-testid="bearing">{state.bearing}</dd>
        <dt>pitch</dt>
        <dd data-testid="pitch">{state.pitch}</dd>
        <dt>bounds</dt>
        <dd data-testid="bounds">{bounds ? bounds.map(round5).join(", ") : "none"}</dd>
        <dt>features</dt>
        <dd data-testid="feature-count">{featureCount}</dd>
        <dt>selected</dt>
        <dd data-testid="selection-count">{selectionCount}</dd>
        <dt>drawings</dt>
        <dd data-testid="drawing-count">{drawingCount}</dd>
        <dt>notes</dt>
        <dd data-testid="annotation-count">{annotationCount}</dd>
      </dl>
    </div>
  );
}
