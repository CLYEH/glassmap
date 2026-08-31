import { isFeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { truncate } from "@/lib/map-tools/shapes";
import type { Annotation, Drawing, SelectionSource } from "@/lib/store/map-store";
import type { MapFeature } from "@/lib/store/tier2";
import { categorySingular } from "./category-labels";
import { DRAWING_COLOR } from "./drawing-style";
import type { DetailRow } from "./feature-details";
import { CATEGORY_COLOR } from "./map-style";
import { resolveSelection } from "./selection-model";

/**
 * What a tap can be about. Three kinds, because the map holds three kinds of
 * mark a person can make or be shown: a place that is *selected*, a note that
 * is *pinned*, and a shape that is *drawn*.
 *
 * The kind is carried by the tap rather than inferred from the id, so the card
 * never has to guess what `drawing:3` is by pattern-matching a string the
 * store owns.
 */
export type CardKind = "feature" | "annotation" | "drawing";

/** Where the card points, in the map container's own pixel coordinates. */
export interface CardTarget {
  kind: CardKind;
  /** A feature id, or the store's own `annotation:<n>` / `drawing:<n>`. */
  id: string;
  x: number;
  y: number;
}

/**
 * What the "On the map" card is allowed to say about who put this mark on the
 * map, and the evidence behind each sentence.
 *
 *  - **user** — the human's, as this page recorded it: the click that selected
 *    the place (`selectionSources`), or the `source` the store wrote when the
 *    note/shape was made. Proven.
 *  - **agent** — recorded as the agent's by `select_features`, or unrecorded on
 *    a link that carried `su`. `su` states the human's ids, so the ids outside
 *    it are the sender's recorded agent selections: proven, then
 *    inferred-from-evidence.
 *  - **link** — unrecorded, and the link stated nothing. Every `su`-less link
 *    is one indistinguishable wire state (a legacy link, or an all-agent link
 *    from the new encoder — byte identity makes them the same bytes), so the
 *    sentence hedges rather than claiming a fact the wire never carried.
 *
 * The bead stays teal in the last case, and only the words change: Ruling 3's
 * recorded asymmetry — a false rose would hide that an agent was involved at
 * all, a false teal only under-credits the human — and it is the direction the
 * codec itself leans. design2-v5 §2.5 and §8.4 item 5.
 */
export type CardProvenance = "user" | "agent" | "link";

export interface CardCopy {
  line: string;
  tag: string;
}

/**
 * One sentence per kind per provenance.
 *
 * Only a *selected place* can be hedged. A note and a shape carry their own
 * `source` in the store and on the wire — `o` has ridden every link since the
 * codec shipped — so there is no state in which this page holds one and does
 * not know whose it is. The types say so: `Record<SelectionSource, …>` for the
 * two marks against `Record<CardProvenance, …>` for the place, which is what
 * makes a "from a shared link" note impossible to write rather than merely
 * unwritten. (A link that omits `o` decodes as the agent's — the same
 * presumption the pin's own colour has always made.)
 */
export const CARD_COPY: {
  feature: Record<CardProvenance, CardCopy>;
  annotation: Record<SelectionSource, CardCopy>;
  drawing: Record<SelectionSource, CardCopy>;
} = {
  feature: {
    user: { line: "On the map — you tapped it", tag: "YOU" },
    agent: { line: "On the map — the agent selected it", tag: "AGENT" },
    link: { line: "On the map — from a shared link", tag: "FROM LINK" },
  },
  annotation: {
    user: { line: "Note — you pinned it", tag: "YOU" },
    agent: { line: "Note — the agent pinned it", tag: "AGENT" },
  },
  drawing: {
    user: { line: "Shape — you drew it", tag: "YOU" },
    agent: { line: "Shape — the agent drew it", tag: "AGENT" },
  },
};

/**
 * @param recorded what `selectionSources` holds for this id, if anything
 * @param attributionExplicit whether the link this page opened carried `su`
 *   (`selectionAttributionExplicit`); false on a page opened without a link,
 *   which is why an unrecorded id on a live page hedges too — nothing on this
 *   page ever claimed it.
 */
export function cardProvenance(
  recorded: SelectionSource | undefined,
  attributionExplicit: boolean,
): CardProvenance {
  if (recorded) return recorded;
  return attributionExplicit ? "agent" : "link";
}

/** A place with no colour of its own: a POI, which the ramp never paints. */
export const POI_SWATCH = "#8fa1b3";

/** Which side of the tap the card hangs on. */
export type CardPlace = "above" | "below";

/**
 * The gap the card keeps from the tap point, on either side: the 16px in
 * `.otm-card`'s own transform (globals.css). Duplicated here because the
 * decision below is about where the card's top edge lands, and that is
 * `tap − gap − height`.
 */
export const CARD_GAP_PX = 16;

/**
 * How close to the top of the map the card may come. Not zero: flush against
 * the edge it slides under the brand bar floating over the canvas.
 */
export const CARD_TOP_MARGIN_PX = 8;

/**
 * Which side of the tap the card hangs on, decided from the card's *measured*
 * height rather than a constant.
 *
 * It used to be a constant — 190px, "roughly the card's own height plus its
 * offset" — and the details section falsified it the day it landed: a bilingual
 * card with three tag rows measures 235px, so every tap between 190 and 251
 * chose "above" and put the name (and the English name under it) off the top of
 * the map. The number was not merely wrong, it was the wrong *kind* of thing:
 * any field T-97 adds re-stales it, silently, in the one place a human cannot
 * see the failure — above the viewport.
 *
 * So the caller measures what it actually rendered and asks this. Pure, so the
 * boundary is a test rather than a screenshot.
 */
export function cardPlacement(tapY: number, cardHeight: number): CardPlace {
  return tapY - CARD_GAP_PX - cardHeight < CARD_TOP_MARGIN_PX ? "below" : "above";
}

/** How much of a note the card's headline shows before it trails off. */
export const CARD_NOTE_CHARS = 72;

/** A shape with no label is named by what it is. */
export const DRAWING_KIND_WORD: Record<Drawing["kind"], string> = {
  circle: "Circle",
  polygon: "Polygon",
  line: "Line",
};

/** "Circle · 800 m" — the radius is the one number a circle is about. */
function drawingWhat(drawing: Drawing): string {
  const word = DRAWING_KIND_WORD[drawing.kind];
  if (drawing.kind !== "circle" || drawing.radius_m === undefined) return word;
  return `${word} · ${Math.round(drawing.radius_m)} m`;
}

/** The card, as words and colours. Everything the component renders. */
export interface CardView {
  kind: CardKind;
  id: string;
  /** The headline: a place's name, a note's text, a shape's label. */
  name: string;
  /**
   * The place's English name, under the headline, when the data carries one
   * that says something the headline does not (`selection-model`). Never on a
   * note or a shape: those are one person's words in one language.
   */
  nameEn?: string;
  /** What kind of thing it is, under the name. */
  what: string;
  /** The dot beside `what`. */
  swatch: string;
  /** Fabricated demo data, which the card has to say out loud. */
  sample: boolean;
  /**
   * The OSM tags this place carries — what the tools have always returned and
   * the card, until now, did not show (`feature-details`). Empty for a note,
   * a shape, and any place whose tags the extract does not have.
   */
  details: DetailRow[];
  provenance: CardProvenance;
  copy: CardCopy;
}

/** The store, narrowed to what a card can be about. */
export interface CardSubjects {
  features: readonly GlassMapFeature[];
  tier2Features: readonly MapFeature[];
  annotations: readonly Annotation[];
  drawings: readonly Drawing[];
  selectionSources: Readonly<Record<string, SelectionSource>>;
  selectionAttributionExplicit: boolean;
}

/**
 * The tapped mark, resolved against the store — or null when the store no
 * longer holds it.
 *
 * Null is the answer to the one race a card has: a tool removes the note a
 * human is reading about (`remove_from_map`), and the card must stop offering
 * "Remove" for something that is already gone. A selected *place* is
 * different — it stays in `features` after a deselect, so nothing here can see
 * that it left the map, and the map's own selection subscription closes the
 * card instead (`closeFor`, MapCanvas).
 *
 * Pure so the whole of what the card says can be asserted without a renderer.
 */
export function cardView(target: CardTarget, subjects: CardSubjects): CardView | null {
  if (target.kind === "annotation") {
    const annotation = subjects.annotations.find((a) => a.id === target.id);
    if (!annotation) return null;
    return {
      kind: "annotation",
      id: annotation.id,
      name: truncate(annotation.note, CARD_NOTE_CHARS),
      what: "Note",
      swatch: DRAWING_COLOR[annotation.source],
      sample: false,
      details: [],
      provenance: annotation.source,
      copy: CARD_COPY.annotation[annotation.source],
    };
  }

  if (target.kind === "drawing") {
    const drawing = subjects.drawings.find((d) => d.id === target.id);
    if (!drawing) return null;
    return {
      kind: "drawing",
      id: drawing.id,
      name: drawing.label ?? DRAWING_KIND_WORD[drawing.kind],
      what: drawingWhat(drawing),
      swatch: DRAWING_COLOR[drawing.source],
      sample: false,
      details: [],
      provenance: drawing.source,
      copy: CARD_COPY.drawing[drawing.source],
    };
  }

  const row = resolveSelection(subjects.features, [target.id], subjects.tier2Features)[0];
  if (!row) return null;
  const provenance = cardProvenance(
    subjects.selectionSources[target.id],
    subjects.selectionAttributionExplicit,
  );
  const category = row.category;
  return {
    kind: "feature",
    id: row.id,
    name: row.name,
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    what: category === null ? "Not loaded" : categorySingular(category),
    swatch: category !== null && isFeatureCategory(category) ? CATEGORY_COLOR[category] : POI_SWATCH,
    sample: row.sample,
    details: row.details,
    provenance,
    copy: CARD_COPY.feature[provenance],
  };
}
