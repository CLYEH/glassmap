"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import { isFeatureCategory } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";
import { CARD_COPY, cardProvenance } from "./card-model";
import { useCardStore } from "./card-store";
import { categorySingular } from "./category-labels";
import { CATEGORY_COLOR } from "./map-style";
import { resolveSelection } from "./selection-model";

/**
 * Above this many pixels from the top of the map, the card hangs above the
 * tap; below it, under. Roughly the card's own height plus its offset — a
 * place near the top edge is exactly where the naive "always above" placement
 * puts the answer off screen.
 */
const CARD_FLIP_PX = 190;

/**
 * The answer a human's tap gets: the place's name, what kind of place it is,
 * who put it on the map, and the two things to do about it.
 *
 * Not a modal, by construction and by law: it is a positioned card with no
 * backdrop and no focus trap, the map keeps panning and zooming under it, and
 * every tool keeps answering while it is open (`alert`/`confirm`/`prompt` would
 * freeze the agent — see CONTRIBUTING). "Keep · close" dismisses it and leaves
 * the place selected; "Remove" takes the place off the map, which is the same
 * deselection a second tap performs.
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
  const selection = useMapStore((s) => s.selection);
  const setSelection = useMapStore((s) => s.setSelection);
  const sources = useMapStore((s) => s.selectionSources);
  const explicit = useMapStore((s) => s.selectionAttributionExplicit);

  const id = target?.id ?? null;
  const row = useMemo(() => {
    if (id === null) return null;
    return resolveSelection(features, [id], tier2Features)[0];
  }, [id, features, tier2Features]);

  // Esc closes it, like every other dismissible surface on this page. Bound
  // only while a card is open, so it can never swallow a keystroke meant for
  // the drawing toolbar.
  useEffect(() => {
    if (id === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, close]);

  if (target === null || row === null) return null;

  const provenance = cardProvenance(sources[target.id], explicit);
  const copy = CARD_COPY[provenance];
  const category = row.category;
  const swatch =
    category !== null && isFeatureCategory(category) ? CATEGORY_COLOR[category] : "#8fa1b3";

  const remove = () => {
    setSelection(
      selection.filter((value) => value !== target.id),
      "user",
    );
    close();
  };

  return (
    <div
      className="otm-card lg deep"
      data-testid="on-the-map-card"
      data-feature-id={target.id}
      data-provenance={provenance}
      // The tap point, handed to CSS rather than applied here: the horizontal
      // clamp is the stylesheet's (it is the one that knows the viewport), and
      // a card whose subject is near the top of the map has to hang below the
      // tap instead of above it, or it opens off screen.
      data-place={target.y < CARD_FLIP_PX ? "below" : "above"}
      style={{ "--otm-x": `${target.x}px`, "--otm-y": `${target.y}px` } as CSSProperties}
      role="group"
      aria-label="On the map"
    >
      <div className="otm-name" data-testid="otm-name">
        {row.name}
      </div>
      <div className="otm-cat" data-testid="otm-category">
        <i aria-hidden style={{ background: swatch }} />
        {category === null ? "Not loaded" : categorySingular(category)}
        {row.sample ? " (sample)" : ""}
      </div>
      <div className="otm-prov" data-testid="otm-provenance">
        <span aria-hidden className={`bead-mini${provenance === "user" ? "" : " teal"}`} />
        {copy.line}
        <span className={`prov${provenance === "user" ? " rose" : ""}`}>{copy.tag}</span>
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
