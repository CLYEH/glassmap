import type { Annotation } from "@/lib/store/map-store";

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
 * Clicking anywhere else on the pin — the stem, the anchor, or the pin by
 * keyboard — asks the same question a tap on any other mark asks, and gets the
 * same answer: `onTap` opens the "On the map" card, which is where a note is
 * removed by hand. The two live on one element because they are two halves of
 * one gesture ("let me see past this" and "what is this?"), and splitting them
 * across two controls would put a second tab stop on every note on the map.
 *
 * `data-testid="annotation-popup"` is on the card, `annotation-pin` on the pin
 * (the FX layer projects effects onto it by id — see `fx/surfaces.ts`).
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

  const stem = document.createElement("span");
  stem.className = "pin-stem";

  const anchor = document.createElement("span");
  anchor.className = "pin-anchor";

  root.append(card, stem, anchor);

  root.addEventListener("click", (event) => {
    // Without this the click also reaches the map, which in draw mode would
    // drop a polygon vertex under the pin.
    event.stopPropagation();
    const target = event.target;
    if (target instanceof Element && target.closest(".pin-card")) {
      card.classList.toggle("hidden");
      return;
    }
    onTap(annotation.id);
  });

  return root;
}
