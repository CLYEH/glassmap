"use client";

import { useEffect } from "react";
import { useDrawStore, type RouteStatus } from "./draw-store";

/**
 * The "human draws, agent reads" entry point: toggles polygon drawing on the
 * map. The clicks themselves are handled in MapCanvas (it owns the map); this
 * component owns the switch, the keyboard shortcuts and the off-screen mirror
 * of the mode.
 *
 * The shortcuts cover *both* hand gestures that own the map's clicks — drawing
 * a polygon and planning a walk (`RoutePill`) — because they are one keyboard:
 * Esc is "stop whatever the next click was going to do", and it must not
 * depend on which of the two pills is lit. Enter finishes a polygon and does
 * nothing in route mode, where there is nothing half-made to keep: a walk is
 * planned by its second click or not at all.
 *
 * Rose, like every hand-drawn shape on the map, against the teal the agent's
 * own tools use. It is the first of the four human pills (`Tools`), and it is
 * there in both chromes: drawing is a thing a person does, agent or no agent.
 */
export function DrawPill() {
  const mode = useDrawStore((s) => s.mode);
  const start = useDrawStore((s) => s.start);
  const cancel = useDrawStore((s) => s.cancel);
  const finish = useDrawStore((s) => s.finish);
  const drawing = mode === "polygon";

  useEffect(() => {
    if (mode === "none") return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Typing a note must not finish or cancel a drawing.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter" && mode === "polygon") {
        // Also stops the focused toggle button from being activated by Enter.
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, cancel, finish]);

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
          test should not have to read a CSS class to know the mode. "on" and
          "off" are the polygon's, kept as they were; "route" is the third
          value the same span grew when the second gesture arrived. */}
      <span data-testid="draw-mode" className="gm-machine">
        {mode === "route" ? "route" : drawing ? "on" : "off"}
      </span>
    </>
  );
}

/**
 * The human half of `plan_route` (T-110): click where the walk starts, click
 * where it ends, and the same FOSSGIS OSRM service the agent's tool asks draws
 * the walk as a rose line a person made.
 *
 * A pill beside Draw rather than a mode inside it, because the two gestures
 * answer different questions and neither is a step of the other — and because
 * "what can I do to this map by hand?" has to be readable off the row itself.
 * The pill is the only control: the second click plans, so there is nothing to
 * confirm, and Esc (handled in `DrawPill`, one keyboard) gets out.
 */
export function RoutePill() {
  const mode = useDrawStore((s) => s.mode);
  const startRoute = useDrawStore((s) => s.startRoute);
  const cancel = useDrawStore((s) => s.cancel);
  const routing = mode === "route";

  return (
    <button
      type="button"
      className="tool-chip lg lens"
      data-testid="route-toggle"
      aria-pressed={routing}
      onClick={() => (routing ? cancel() : startRoute())}
    >
      {/* Two ends and the walk between them: the same picture the drawing on
          the map makes, at 13px. */}
      <svg className="rose" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="3.2" cy="10.8" r="1.7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10.8" cy="3.2" r="1.7" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M4.9 9.6c2-.4 2.2-2 1.3-3.2C5.3 5.2 6.4 4 9.1 3.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="lbl">{routing ? "Cancel" : "Route"}</span>
    </button>
  );
}

/** The error sentence plus what to do next, which depends on what is left. */
function routeHint(points: number, status: RouteStatus): string {
  if (status === "planning") return "Planning the walk…";
  // The service's sentences (and the same-point guard's) end without a full
  // stop, so the instruction that follows supplies it — and it is a different
  // instruction depending on whether the start survived the failure.
  if (typeof status === "object") {
    return `${status.error}. ${points === 1 ? "Click where it ends." : "Click a new start, or Esc."}`;
  }
  return points === 0 ? "Click where the walk starts. Esc to cancel." : "Click where it ends.";
}

/**
 * What to do with the map while a hand gesture owns its clicks, under the pill
 * that turned it on. Separate from the pills because it hangs below the row
 * rather than in it, and it exists only while there is something to say.
 *
 * It is also where a walk that could not be planned is reported — the routing
 * service's own sentence, verbatim, in the place the person was already
 * reading. Not a toast and never an `alert`: the failure leaves the map in
 * route mode waiting for another click, so the message belongs where the
 * instruction it replaces was.
 */
export function DrawHint() {
  const mode = useDrawStore((s) => s.mode);
  const vertexCount = useDrawStore((s) => s.draft.length);
  const routePoints = useDrawStore((s) => s.routeDraft.length);
  const routeStatus = useDrawStore((s) => s.routeStatus);
  if (mode === "none") return null;
  return (
    <p data-testid="draw-hint" data-mode={mode} className="draw-hint lg">
      <span aria-hidden className="sw" />
      {mode === "route"
        ? routeHint(routePoints, routeStatus)
        : vertexCount < 3
          ? `Click the map to add points (${vertexCount} of at least 3).`
          : `${vertexCount} points. Double-click or Enter to finish, Esc to cancel.`}
    </p>
  );
}
