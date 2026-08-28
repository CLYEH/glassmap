"use client";

import { useEffect } from "react";
import { useDrawStore } from "./draw-store";

/**
 * The "human draws, agent reads" entry point: toggles polygon drawing on the
 * map. The clicks themselves are handled in MapCanvas (it owns the map); this
 * component owns the switch, the hint and the keyboard shortcuts.
 */
export function DrawToolbar() {
  const mode = useDrawStore((s) => s.mode);
  const vertexCount = useDrawStore((s) => s.draft.length);
  const start = useDrawStore((s) => s.start);
  const cancel = useDrawStore((s) => s.cancel);
  const finish = useDrawStore((s) => s.finish);
  const drawing = mode === "polygon";

  useEffect(() => {
    if (!drawing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Typing a note in the sidebar must not finish or cancel a drawing.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter") {
        // Also stops the focused toggle button from being activated by Enter.
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing, cancel, finish]);

  return (
    <div
      data-testid="draw-toolbar"
      // Bottom right on a phone-width map, where it does not land on the state
      // overlay; top right once there is room beside it.
      className="absolute right-3 bottom-9 z-10 w-56 rounded-lg bg-white/90 p-2 font-mono text-xs text-zinc-900 shadow-lg backdrop-blur md:top-3 md:bottom-auto"
    >
      <button
        type="button"
        data-testid="draw-toggle"
        aria-pressed={drawing}
        onClick={() => (drawing ? cancel() : start())}
        className={`w-full rounded px-2 py-1 font-sans font-medium text-white ${
          drawing ? "bg-rose-600 hover:bg-rose-700" : "bg-zinc-800 hover:bg-zinc-700"
        }`}
      >
        {drawing ? "Cancel drawing" : "Draw a polygon"}
      </button>
      <p className="mt-1.5 flex justify-between">
        <span>draw mode</span>
        <span data-testid="draw-mode">{drawing ? "on" : "off"}</span>
      </p>
      {drawing && (
        <p data-testid="draw-hint" className="mt-1 leading-snug text-zinc-600">
          {vertexCount < 3
            ? `Click the map to add points (${vertexCount} of at least 3).`
            : `${vertexCount} points. Double-click or Enter to finish, Esc to cancel.`}
        </p>
      )}
    </div>
  );
}
