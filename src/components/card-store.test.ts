import { beforeEach, describe, expect, it } from "vitest";
import { useCardStore } from "./card-store";

/**
 * The card follows one mark — a place, a note or a shape. The map opens and
 * closes it from click handlers that know only which mark was tapped, so the
 * store has to be the thing that decides whether a given event is about the
 * card that is open.
 */
describe("useCardStore", () => {
  beforeEach(() => useCardStore.getState().close());

  it("opens on the tapped place, at the tap", () => {
    useCardStore.getState().open({ kind: "feature", id: "osm:node:1", x: 120, y: 340 });
    expect(useCardStore.getState().target).toEqual({
      kind: "feature",
      id: "osm:node:1",
      x: 120,
      y: 340,
    });
  });

  it("closes the card of a place that was just taken off the map", () => {
    // The map's toggle: tapping a selected place deselects it, and the card
    // about it has to go with it — leaving it up would offer "Remove" for
    // something that is no longer there.
    useCardStore.getState().open({ kind: "feature", id: "osm:node:1", x: 1, y: 2 });
    useCardStore.getState().closeFor("osm:node:1");
    expect(useCardStore.getState().target).toBeNull();
  });

  it("leaves a card about a different place alone", () => {
    // Deselecting one place must not dismiss the card someone is reading
    // about another — the two are unrelated events on the same map.
    useCardStore.getState().open({ kind: "feature", id: "osm:node:1", x: 1, y: 2 });
    useCardStore.getState().closeFor("osm:node:2");
    expect(useCardStore.getState().target?.id).toBe("osm:node:1");
  });
});
