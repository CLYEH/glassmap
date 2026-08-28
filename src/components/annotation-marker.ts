import type { Annotation } from "@/lib/store/map-store";
import { DRAWING_COLOR } from "./drawing-style";

/**
 * The DOM of one annotation pin, used as a MapLibre marker element.
 *
 * Built imperatively for the same reason the rest of the map is: MapCanvas
 * owns the map and must not re-render. The note is written with `textContent`
 * (never `innerHTML`) - notes come from agents and from users, and the bubble
 * is a plain positioned div, never a `window.alert`, which would freeze the
 * agent that wrote it.
 *
 * The bubble shows on hover and on focus via CSS, and a click toggles it so it
 * can be kept open while reading; `data-testid="annotation-popup"` is on the
 * bubble, `data-testid="annotation-pin"` on the pin.
 */
export function createAnnotationElement(annotation: Annotation): HTMLElement {
  const color = DRAWING_COLOR[annotation.source];

  const root = document.createElement("button");
  root.type = "button";
  root.className = "group relative flex cursor-pointer flex-col items-center border-0 bg-transparent p-0";
  root.dataset.testid = "annotation-pin";
  root.dataset.annotationId = annotation.id;
  root.dataset.annotationSource = annotation.source;
  root.setAttribute("aria-label", `Note: ${annotation.note}`);

  const bubble = document.createElement("span");
  bubble.dataset.testid = "annotation-popup";
  bubble.dataset.annotationId = annotation.id;
  bubble.className =
    "pointer-events-none absolute bottom-full left-1/2 mb-1 hidden w-44 -translate-x-1/2 rounded bg-white/95 px-2 py-1 text-left text-xs leading-snug break-words whitespace-pre-wrap text-zinc-900 shadow-lg group-hover:block group-focus:block";
  bubble.textContent = annotation.note;

  const dot = document.createElement("span");
  dot.className = "block size-3.5 rounded-full border-2 border-white shadow";
  dot.style.backgroundColor = color;

  const stem = document.createElement("span");
  stem.className = "block h-2 w-0.5";
  stem.style.backgroundColor = color;

  root.append(bubble, dot, stem);

  root.addEventListener("click", (event) => {
    // Without this the click also reaches the map, which in draw mode would
    // drop a polygon vertex under the pin.
    event.stopPropagation();
    bubble.classList.toggle("hidden");
  });

  return root;
}
