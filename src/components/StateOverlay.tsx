"use client";

import { describeView, round5 } from "@/lib/map-tools/state";
import { FEATURE_CATEGORIES } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "./map-style";

/**
 * The store rendered as text. Every value a tool can change has a
 * `data-testid` so e2e can assert the effect without reading the canvas.
 * It stays useful when WebGL is unavailable and no map is drawn.
 */
export function StateOverlay() {
  const view = useMapStore((s) => s.view);
  const bounds = useMapStore((s) => s.bounds);
  const featureCount = useMapStore((s) => s.features.length);
  const selectionCount = useMapStore((s) => s.selection.length);
  const state = describeView(view);

  return (
    <div
      data-testid="state-overlay"
      className="absolute top-3 left-3 z-10 max-w-xs rounded-lg bg-white/90 p-3 font-mono text-xs text-zinc-900 shadow-lg backdrop-blur"
    >
      <h1 className="mb-2 text-sm font-semibold">GlassMap</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
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
      </dl>
      <ul data-testid="legend" className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {FEATURE_CATEGORIES.map((category) => (
          <li key={category} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: CATEGORY_COLOR[category] }}
            />
            {CATEGORY_LABEL[category]}
          </li>
        ))}
      </ul>
    </div>
  );
}
