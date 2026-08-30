"use client";

import { useEffect } from "react";
import { useDrawStore } from "./draw-store";

/**
 * The "human draws, agent reads" entry point: toggles polygon drawing on the
 * map. The clicks themselves are handled in MapCanvas (it owns the map); this
 * component owns the switch, the keyboard shortcuts and the off-screen mirror
 * of the mode.
 *
 * Rose, like every hand-drawn shape on the map, against the teal the agent's
 * own tools use. It is the first of the three human pills (`Tools`), and it is
 * there in both chromes: drawing is a thing a person does, agent or no agent.
 */
export function DrawPill() {
  const mode = useDrawStore((s) => s.mode);
  const start = useDrawStore((s) => s.start);
  const cancel = useDrawStore((s) => s.cancel);
  const finish = useDrawStore((s) => s.finish);
  const drawing = mode === "polygon";

  useEffect(() => {
    if (!drawing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Typing a note must not finish or cancel a drawing.
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
    <>
      <button
        type="button"
        className="tool-chip lg lens"
        data-testid="draw-toggle"
        aria-pressed={drawing}
        onClick={() => (drawing ? cancel() : start())}
      >
        <svg className="rose" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M7 1l6 4.4-2.3 7H3.3L1 5.4z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span className="lbl">{drawing ? "Cancel" : "Draw"}</span>
      </button>
      {/* Off screen: the chip's pressed state is the visible answer, but a
          test should not have to read a CSS class to know the mode. */}
      <span data-testid="draw-mode" className="gm-machine">
        {drawing ? "on" : "off"}
      </span>
    </>
  );
}

/**
 * What to do with the map while drawing is on, under the pill that turned it
 * on. Separate from the pill because it hangs below the row rather than in it,
 * and it exists only while there is something to say.
 */
export function DrawHint() {
  const mode = useDrawStore((s) => s.mode);
  const vertexCount = useDrawStore((s) => s.draft.length);
  if (mode !== "polygon") return null;
  return (
    <p data-testid="draw-hint" className="draw-hint lg">
      <span aria-hidden className="sw" />
      {vertexCount < 3
        ? `Click the map to add points (${vertexCount} of at least 3).`
        : `${vertexCount} points. Double-click or Enter to finish, Esc to cancel.`}
    </p>
  );
}
