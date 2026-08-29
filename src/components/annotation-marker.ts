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
 * clicking the pin folds it away when several sit on top of each other.
 * `data-testid="annotation-popup"` is on the card, `annotation-pin` on the pin.
 */
export function createAnnotationElement(annotation: Annotation): HTMLElement {
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
    card.classList.toggle("hidden");
  });

  return root;
}
