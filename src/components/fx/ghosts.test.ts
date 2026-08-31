import { describe, expect, it } from "vitest";
import type { Annotation, Drawing } from "@/lib/store/map-store";
import { createGhostMemory, type MarkState } from "./ghosts";

const CIRCLE: Drawing = {
  id: "drawing:1",
  source: "agent",
  kind: "circle",
  center: [121.5436, 25.0334],
  radius_m: 800,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.55, 25.0334],
        [121.5436, 25.04],
        [121.537, 25.0334],
        [121.55, 25.0334],
      ],
    ],
  },
};

const NOTE: Annotation = {
  id: "annotation:1",
  source: "agent",
  at: [121.54, 25.03],
  note: "quiet street",
};

const state = (drawings: Drawing[], annotations: Annotation[]): MarkState => ({
  drawings,
  annotations,
});

/**
 * Why this exists at all: `remove_from_map` records its feed row *after* the
 * store write that removed the mark, so the effect that dissolves it is planned
 * against a store that no longer contains it. This memory is the only thing on
 * the page that still knows where the mark was — get it wrong and the removal
 * is the one tool call that draws nothing.
 */
describe("the ghost memory", () => {
  it("keeps the outline of a shape that left the map", () => {
    const ghosts = createGhostMemory();
    ghosts.observe(state([CIRCLE], []), state([], []));
    expect(ghosts.recall("drawing:1")).toEqual({
      positions: [
        [121.55, 25.0334],
        [121.5436, 25.04],
        [121.537, 25.0334],
        [121.55, 25.0334],
      ],
      closed: true,
    });
  });

  it("keeps a note as the single point it was pinned at", () => {
    const ghosts = createGhostMemory();
    ghosts.observe(state([], [NOTE]), state([], []));
    expect(ghosts.recall("annotation:1")).toEqual({ positions: [[121.54, 25.03]], closed: false });
  });

  it("remembers nothing about a mark that is still there", () => {
    // A ghost of a live mark would let a removal that refused (a shape the
    // human drew) dissolve it anyway — the map showing a deletion that the
    // tool declined to make.
    const ghosts = createGhostMemory();
    const marks = state([CIRCLE], [NOTE]);
    ghosts.observe(marks, state([CIRCLE], [NOTE]));
    expect(ghosts.recall("drawing:1")).toBeNull();
    expect(ghosts.recall("annotation:1")).toBeNull();
  });

  it("remembers nothing about an addition", () => {
    // Opening a share link appends every shape the link carried, one write at
    // a time. Only departures are recorded, so a restore leaves no ghosts.
    const ghosts = createGhostMemory();
    ghosts.observe(state([], []), state([CIRCLE], [NOTE]));
    expect(ghosts.recall("drawing:1")).toBeNull();
  });

  it("is a buffer, not a history: past the limit the oldest is forgotten", () => {
    // Bounded on purpose. A session that draws and removes all afternoon must
    // not grow a map of every shape it ever held.
    const ghosts = createGhostMemory(2);
    const shape = (n: number): Drawing => ({ ...CIRCLE, id: `drawing:${n}` });
    for (const n of [1, 2, 3]) ghosts.observe(state([shape(n)], []), state([], []));
    expect(ghosts.recall("drawing:1")).toBeNull();
    expect(ghosts.recall("drawing:3")).not.toBeNull();
  });
});
