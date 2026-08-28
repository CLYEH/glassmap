"use client";

import { useMapStore } from "@/lib/store/map-store";
import { describeView } from "@/lib/map-tools/state";

/** Placeholder until MapLibre lands (D1): shows the store state so tools have a visible effect. */
export default function Home() {
  const view = useMapStore((s) => s.view);
  const state = describeView(view);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 font-mono">
      <h1 className="text-2xl font-semibold">GlassMap</h1>
      <p className="text-sm text-zinc-500">map placeholder — MapLibre arrives in D1</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
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
      </dl>
    </main>
  );
}
