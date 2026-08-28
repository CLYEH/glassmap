"use client";

import { useMemo, useState } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { AddNoteForm } from "./AddNoteForm";
import { DRAWING_COLOR } from "./drawing-style";
import { CATEGORY_LABEL } from "./map-style";
import { resolveSelection } from "./selection-model";

/**
 * What the agent has done, in words: the selected features, the shapes on the
 * map and the pinned notes, each removable by hand.
 *
 * It is a column of the page layout, not an overlay, so on a narrow window it
 * sits under the map instead of covering it. Collapsing hides the panel body
 * with CSS rather than unmounting it: the declarative `add_note` form lives in
 * here, and a tool that disappears when a human folds a panel would be a
 * confusing thing to hand an agent.
 */
export function Sidebar() {
  const [open, setOpen] = useState(true);
  const features = useMapStore((s) => s.features);
  const selection = useMapStore((s) => s.selection);
  const drawings = useMapStore((s) => s.drawings);
  const annotations = useMapStore((s) => s.annotations);
  const removeDrawing = useMapStore((s) => s.removeDrawing);
  const removeAnnotation = useMapStore((s) => s.removeAnnotation);

  const rows = useMemo(() => resolveSelection(features, selection), [features, selection]);

  return (
    <aside
      data-testid="sidebar"
      data-open={open}
      className="flex max-h-[45vh] w-full shrink-0 flex-col border-t border-zinc-200 bg-white font-mono text-xs text-zinc-900 md:h-full md:max-h-none md:w-80 md:border-t-0 md:border-l"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <h2 className="text-sm font-semibold">Map contents</h2>
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-expanded={open}
          aria-controls="sidebar-body"
          onClick={() => setOpen((value) => !value)}
          className="rounded px-2 py-0.5 font-sans hover:bg-zinc-100"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      <div
        id="sidebar-body"
        className={`flex-1 space-y-4 overflow-y-auto px-3 py-3 pb-12 ${open ? "" : "hidden"}`}
      >
        <section>
          <h3 className="flex items-center justify-between font-semibold">
            <span>Selected features</span>
            <span data-testid="sidebar-selection-count">{rows.length}</span>
          </h3>
          <ul data-testid="sidebar-selection" className="mt-1 space-y-1">
            {rows.length === 0 && <li className="text-zinc-500">Nothing selected.</li>}
            {rows.map((row) => (
              <li key={row.id} data-feature-id={row.id} className="leading-snug">
                <span className="block break-words">{row.name}</span>
                <span className="block text-zinc-500">
                  {row.category ? CATEGORY_LABEL[row.category] : "not loaded"}
                  {row.sample ? " (sample)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="flex items-center justify-between font-semibold">
            <span>Drawings</span>
            <span data-testid="sidebar-drawings-count">{drawings.length}</span>
          </h3>
          <ul data-testid="sidebar-drawings" className="mt-1 space-y-1">
            {drawings.length === 0 && <li className="text-zinc-500">No shapes drawn.</li>}
            {drawings.map((drawing) => (
              <li
                key={drawing.id}
                data-drawing-id={drawing.id}
                className="flex items-start gap-1.5 leading-snug"
              >
                <span
                  aria-hidden
                  className="mt-1 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: DRAWING_COLOR[drawing.source] }}
                />
                <span className="min-w-0 flex-1 break-words">
                  {drawing.label ?? drawing.kind}
                  <span className="block text-zinc-500">
                    {drawing.kind} · drawn by {drawing.source}
                  </span>
                </span>
                <button
                  type="button"
                  data-testid="remove-drawing"
                  data-drawing-id={drawing.id}
                  aria-label={`Remove drawing ${drawing.id}`}
                  onClick={() => removeDrawing(drawing.id)}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="flex items-center justify-between font-semibold">
            <span>Notes</span>
            <span data-testid="sidebar-annotations-count">{annotations.length}</span>
          </h3>
          <ul data-testid="sidebar-annotations" className="mt-1 space-y-1">
            {annotations.length === 0 && <li className="text-zinc-500">No notes pinned.</li>}
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                data-annotation-id={annotation.id}
                className="flex items-start gap-1.5 leading-snug"
              >
                <span
                  aria-hidden
                  className="mt-1 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: DRAWING_COLOR[annotation.source] }}
                />
                <span className="min-w-0 flex-1 break-words">
                  {annotation.note}
                  <span className="block text-zinc-500">pinned by {annotation.source}</span>
                </span>
                <button
                  type="button"
                  data-testid="remove-annotation"
                  data-annotation-id={annotation.id}
                  aria-label={`Remove note ${annotation.id}`}
                  onClick={() => removeAnnotation(annotation.id)}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-zinc-200 pt-3">
          <AddNoteForm />
        </section>
      </div>
    </aside>
  );
}
