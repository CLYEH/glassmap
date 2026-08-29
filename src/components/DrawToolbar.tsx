"use client";

import { useEffect } from "react";
import { useDrawStore } from "./draw-store";

/**
 * The "human draws, agent reads" entry point: toggles polygon drawing on the
 * map. The clicks themselves are handled in MapCanvas (it owns the map); this
 * component owns the switch, the hint and the keyboard shortcuts.
 *
 * Rose, like every hand-drawn shape on the map, against the teal the agent's
 * own tools use. On a phone the label goes and the pentagon carries it.
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
      // Typing a note in the inspector must not finish or cancel a drawing.
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
    <div className="draw-zone" data-testid="draw-toolbar">
      <button
        type="button"
        className="draw-chip"
        data-testid="draw-toggle"
        aria-pressed={drawing}
        onClick={() => (drawing ? cancel() : start())}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M7 1.8 12.4 5.7 10.3 12H3.7L1.6 5.7 7 1.8Z"
            stroke="#f48fb1"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="1.8" r="1.4" fill="#f48fb1" />
        </svg>
        <span>{drawing ? "Cancel drawing" : "Draw polygon"}</span>
      </button>
      {/* Off screen: the chip's pressed state is the visible answer, but a
          test should not have to read a CSS class to know the mode. */}
      <span data-testid="draw-mode" className="gm-machine">
        {drawing ? "on" : "off"}
      </span>
      {drawing && (
        <p data-testid="draw-hint" className="draw-hint glass">
          {vertexCount < 3
            ? `Click the map to add points (${vertexCount} of at least 3).`
            : `${vertexCount} points. Double-click or Enter to finish, Esc to cancel.`}
        </p>
      )}
    </div>
  );
}
