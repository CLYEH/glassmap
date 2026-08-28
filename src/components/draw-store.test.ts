import { beforeEach, describe, expect, it } from "vitest";
import { useMapStore } from "@/lib/store/map-store";
import { useDrawStore } from "./draw-store";

const draw = () => useDrawStore.getState();
const map = () => useMapStore.getState();

describe("draw store", () => {
  beforeEach(() => {
    useDrawStore.setState({ mode: "none", draft: [] });
    useMapStore.setState({ drawings: [], drawingSeq: 1 });
  });

  it("hands a finished polygon to the map store as a user drawing", () => {
    // This is the whole point of hand drawing: the shape has to end up where
    // the tools look, tagged as drawn by a human.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.6, 25]);
    draw().addVertex([121.6, 25.1]);
    const stored = draw().finish();

    expect(stored).toMatchObject({ id: "drawing:1", source: "user", kind: "polygon" });
    expect(map().drawings).toHaveLength(1);
    expect(map().drawings[0].geometry.type).toBe("Polygon");
  });

  it("leaves draw mode and clears the draft after finishing", () => {
    draw().start();
    for (const vertex of [
      [121.5, 25],
      [121.6, 25],
      [121.6, 25.1],
    ] as [number, number][]) {
      draw().addVertex(vertex);
    }
    draw().finish();

    expect(draw().mode).toBe("none");
    expect(draw().draft).toEqual([]);
  });

  it("refuses to store a shape with fewer than three corners, and keeps drawing", () => {
    // Enter or a double-click on the second point must not drop an empty
    // polygon into state an agent will later query.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.6, 25]);

    expect(draw().finish()).toBeNull();
    expect(map().drawings).toEqual([]);
    expect(draw().mode).toBe("polygon");
    expect(draw().draft).toHaveLength(2);
  });

  it("rounds every corner to ~1 m as it is clicked", () => {
    // The draft the preview draws and the polygon the store keeps have to be
    // the same numbers: rounding later, in whatever serializes a drawing for a
    // tool, would make the shape on screen and the shape an agent reads back
    // disagree.
    draw().start();
    draw().addVertex([121.5175123456, 25.0478987654]);
    expect(draw().draft).toEqual([[121.51751, 25.0479]]);

    draw().addVertex([121.6000004, 25.0000004]);
    draw().addVertex([121.6000004, 25.1000004]);
    const stored = draw().finish();
    expect(stored!.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [121.51751, 25.0479],
          [121.6, 25],
          [121.6, 25.1],
          [121.51751, 25.0479],
        ],
      ],
    });
  });

  it("treats two clicks inside the same metre as one corner", () => {
    // Rounding must not be able to smuggle a duplicate corner into a ring.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().addVertex([121.5000001, 25.0000001]);
    draw().addVertex([121.6, 25]);
    expect(draw().finish()).toBeNull();
    expect(map().drawings).toEqual([]);
  });

  it("throws the draft away on cancel without touching the map store", () => {
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().cancel();

    expect(draw()).toMatchObject({ mode: "none", draft: [] });
    expect(map().drawings).toEqual([]);
  });

  it("starts from an empty draft every time", () => {
    // A cancelled-then-restarted drawing must not inherit old vertices.
    draw().start();
    draw().addVertex([121.5, 25]);
    draw().start();
    expect(draw().draft).toEqual([]);
  });
});
