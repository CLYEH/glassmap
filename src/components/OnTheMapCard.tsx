"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { cardView } from "./card-model";
import { useCardStore } from "./card-store";

/**
 * Above this many pixels from the top of the map, the card hangs above the
 * tap; below it, under. Roughly the card's own height plus its offset — a
 * place near the top edge is exactly where the naive "always above" placement
 * puts the answer off screen.
 */
const CARD_FLIP_PX = 190;

/**
 * The answer a human's tap gets: what this mark is, who put it on the map, and
 * the two things to do about it.
 *
 * It answers for all three kinds of mark, and that is the point rather than a
 * generalisation: a person alone on this page (no agent, no inspector, no feed)
 * can pin a note or draw a shape, and until the card covered them the only way
 * back was a tool call they had no agent to make. Tap it, read who made it,
 * press Remove. `Remove` is `setSelection` minus the id, `removeAnnotation` or
 * `removeDrawing` — the same three writers `remove_from_map` gives an agent, so
 * both halves of the gesture leave the store in the same shape. What the two
 * halves are *allowed* to take off differs, and deliberately: either may drop a
 * feature out of the highlight, but a shape drawn or a note written by hand is
 * refused to the agent (`lib/map-tools/remove.ts`), and this button is the only
 * thing on the page that removes one of those.
 *
 * Not a modal, by construction and by law: it is a positioned card with no
 * backdrop and no focus trap, the map keeps panning and zooming under it, and
 * every tool keeps answering while it is open (`alert`/`confirm`/`prompt` would
 * freeze the agent — see CONTRIBUTING). "Keep · close" dismisses it and leaves
 * the mark alone.
 *
 * Desktop anchors it to the tap; below 641px it docks above the Places dock
 * (globals.css), because a card pinned to a fingertip on a phone lands under
 * the finger.
 */
export function OnTheMapCard() {
  const target = useCardStore((s) => s.target);
  const close = useCardStore((s) => s.close);
  const features = useMapStore((s) => s.features);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const annotations = useMapStore((s) => s.annotations);
  const drawings = useMapStore((s) => s.drawings);
  const selection = useMapStore((s) => s.selection);
  const setSelection = useMapStore((s) => s.setSelection);
  const removeAnnotation = useMapStore((s) => s.removeAnnotation);
  const removeDrawing = useMapStore((s) => s.removeDrawing);
  const selectionSources = useMapStore((s) => s.selectionSources);
  const selectionAttributionExplicit = useMapStore((s) => s.selectionAttributionExplicit);

  const view = useMemo(() => {
    if (target === null) return null;
    return cardView(target, {
      features,
      tier2Features,
      annotations,
      drawings,
      selectionSources,
      selectionAttributionExplicit,
    });
  }, [
    target,
    features,
    tier2Features,
    annotations,
    drawings,
    selectionSources,
    selectionAttributionExplicit,
  ]);

  // Esc closes it, like every other dismissible surface on this page. Bound
  // only while a card is open, so it can never swallow a keystroke meant for
  // the drawing toolbar.
  const open = view !== null;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Either nothing was tapped, or a tool removed what was: a card about a note
  // that no longer exists would offer to remove it twice.
  if (target === null || view === null) return null;

  const remove = () => {
    if (view.kind === "annotation") removeAnnotation(view.id);
    else if (view.kind === "drawing") removeDrawing(view.id);
    else {
      setSelection(
        selection.filter((value) => value !== view.id),
        "user",
      );
    }
    close();
  };

  return (
    <div
      className="otm-card lg deep"
      data-testid="on-the-map-card"
      data-kind={view.kind}
      data-card-id={view.id}
      data-provenance={view.provenance}
      // The tap point, handed to CSS rather than applied here: the horizontal
      // clamp is the stylesheet's (it is the one that knows the viewport and
      // the inspector's lane), and a card whose subject is near the top of the
      // map has to hang below the tap instead of above it, or it opens off
      // screen.
      data-place={target.y < CARD_FLIP_PX ? "below" : "above"}
      style={{ "--otm-x": `${target.x}px`, "--otm-y": `${target.y}px` } as CSSProperties}
      role="group"
      aria-label="On the map"
    >
      <div className="otm-name" data-testid="otm-name">
        {view.name}
      </div>
      <div className="otm-cat" data-testid="otm-category">
        <i aria-hidden style={{ background: view.swatch }} />
        {view.what}
        {view.sample ? " (sample)" : ""}
      </div>
      <div className="otm-prov" data-testid="otm-provenance">
        <span aria-hidden className={`bead-mini${view.provenance === "user" ? "" : " teal"}`} />
        {view.copy.line}
        <span className={`prov${view.provenance === "user" ? " rose" : ""}`}>{view.copy.tag}</span>
      </div>
      <div className="otm-actions">
        <button type="button" className="otm-btn" data-testid="otm-remove" onClick={remove}>
          Remove
        </button>
        <button type="button" className="otm-btn" data-testid="otm-close" onClick={close}>
          Keep · close
        </button>
      </div>
    </div>
  );
}
