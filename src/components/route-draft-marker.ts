/**
 * Where the walk a person is planning starts, while it has one end and not
 * two (T-110).
 *
 * Its own element rather than the note's provisional pin (`annotation-marker
 * .ts`): the two marks say different things — "the note you are typing lands
 * here" against "the walk starts here, click where it ends" — and a person who
 * has learnt the dashed hollow pin as *the note being placed* should not meet
 * it again meaning something else. A filled rose ring with a white collar,
 * which is what the end of a drawn line looks like on this map.
 *
 * Built imperatively, click-through and `aria-hidden` for the same reasons the
 * note draft pin is: MapCanvas owns the map and must not re-render, the next
 * click on the map is how the walk is finished, and the hint under the tools
 * row is what actually announces the state.
 */
export function createRouteDraftElement(): HTMLElement {
  const root = document.createElement("span");
  root.className = "route-draft-pin";
  root.dataset.testid = "route-draft-pin";
  root.setAttribute("aria-hidden", "true");
  return root;
}
