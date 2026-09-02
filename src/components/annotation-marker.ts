import type { Annotation } from "@/lib/store/map-store";

/** How much of the note a folded pin keeps, before the ellipsis. */
const FOLDED_LABEL_CHARS = 14;

/**
 * The note, folded down to something a person can still recognise it by: its
 * first word, clipped, and an ellipsis saying there is more behind it. A note
 * with no spaces (a Chinese one, say) is clipped by length alone.
 */
export function foldedLabel(note: string): string {
  const first = note.trim().split(/\s+/)[0] ?? "";
  return first ? `${first.slice(0, FOLDED_LABEL_CHARS)}…` : "…";
}

/**
 * The DOM of one annotation pin, used as a MapLibre marker element: a glass
 * card carrying who pinned it and what it says, a stem, and a white-ringed
 * anchor on the point itself.
 *
 * Built imperatively for the same reason the rest of the map is: MapCanvas
 * owns the map and must not re-render. The note is written with `textContent`
 * (never `innerHTML`) - notes come from agents and from users, and the card is
 * a plain positioned div, never a `window.alert`, which would freeze the agent
 * that wrote it.
 *
 * The card is visible by default because a note nobody can read is not a note;
 * clicking the card itself folds it away when several sit on top of each other.
 * **Folding is a two-way gesture** (T-107): a folded pin keeps a chip on screen
 * — its source colour and the first word of the note — and a click anywhere on
 * a folded pin unfolds it and does nothing else. Before, folding left a 9 px
 * anchor whose only remaining answer was `onTap`, so a note a person folded
 * read as a note that had vanished.
 *
 * Unfolded, the pin still answers two questions with one control: clicking the
 * card folds it, and clicking anywhere else - the stem, the anchor, or the pin
 * by keyboard - asks the same question a tap on any other mark asks, and gets
 * the same answer: `onTap` opens the "On the map" card, which is where a note
 * is removed by hand and, since T-108, where its full text is legible. The two
 * live on one element because they are two halves of one gesture ("let me see
 * past this" and "what is this?"), and splitting them across two controls would
 * put a second tab stop on every note on the map.
 *
 * `data-testid="annotation-popup"` is on the card, `annotation-pin` on the pin
 * (the FX layer projects effects onto it by id — see `fx/surfaces.ts`), and
 * `data-folded` on the pin is the state, so a test never has to read a class.
 */
export function createAnnotationElement(
  annotation: Annotation,
  onTap: (id: string) => void,
): HTMLElement {
  const root = document.createElement("button");
  root.type = "button";
  root.className = "note-pin";
  root.dataset.testid = "annotation-pin";
  root.dataset.annotationId = annotation.id;
  root.dataset.annotationSource = annotation.source;
  root.setAttribute("aria-label", `Note: ${annotation.note}`);

  const card = document.createElement("span");
  card.dataset.testid = "annotation-popup";
  card.dataset.annotationId = annotation.id;
  card.className = annotation.source === "user" ? "pin-card user" : "pin-card";

  const source = document.createElement("span");
  source.className = "pin-src";
  source.textContent = `${annotation.source} · ${annotation.id}`;

  const note = document.createElement("span");
  note.className = "pin-note";
  note.textContent = annotation.note;

  card.append(source, note);

  // What a folded pin leaves on the map: the source's own colour and enough of
  // the note to recognise it by. Never `display: none` on its own account -
  // this is the way back.
  const chip = document.createElement("span");
  chip.className = "pin-chip";
  chip.dataset.testid = "annotation-chip";
  const chipDot = document.createElement("span");
  chipDot.className = "pin-chip-dot";
  const chipLabel = document.createElement("span");
  chipLabel.className = "pin-chip-label";
  chipLabel.textContent = foldedLabel(annotation.note);
  chip.append(chipDot, chipLabel);

  const stem = document.createElement("span");
  stem.className = "pin-stem";

  const anchor = document.createElement("span");
  anchor.className = "pin-anchor";

  root.append(card, chip, stem, anchor);

  const setFolded = (folded: boolean) => {
    root.dataset.folded = String(folded);
    card.classList.toggle("hidden", folded);
  };
  setFolded(false);

  root.addEventListener("click", (event) => {
    // Without this the click also reaches the map, which in draw mode would
    // drop a polygon vertex under the pin - or, with the note popover open,
    // move the pin a person is about to place.
    event.stopPropagation();
    // A folded pin has one thing to say, and it is "here I am again". Asking
    // it anything else - including `onTap`, which the anchor answers when the
    // note is open - would leave the fold with no way out.
    if (root.dataset.folded === "true") {
      setFolded(false);
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".pin-card")) {
      setFolded(true);
      return;
    }
    onTap(annotation.id);
  });

  return root;
}

/**
 * The provisional pin: where a note *would* land if it were pinned now.
 *
 * Rose, like every hand mark, and hollow - a dashed ring on a dashed stem -
 * because it is not a note yet. It has no id, it is not in the map store and
 * no tool can see it (`note-store.ts`); it exists between the click that chose
 * a place and the submit that pins one. `pointer-events: none` (globals.css)
 * so the second click of "actually, over there" goes through it to the map.
 */
export function createNoteDraftElement(): HTMLElement {
  const root = document.createElement("span");
  root.className = "note-draft-pin";
  root.dataset.testid = "note-draft-pin";
  // Announced by the form's label and status line, not by a floating shape: a
  // screen reader following the caret in the note field should not have this
  // read to it as a control it can reach.
  root.setAttribute("aria-hidden", "true");

  const stem = document.createElement("span");
  stem.className = "draft-stem";

  const anchor = document.createElement("span");
  anchor.className = "draft-anchor";

  root.append(stem, anchor);
  return root;
}
