import { describe, expect, it } from "vitest";
import type { Drawing, LngLat } from "@/lib/store/map-store";
import {
  DRAFT_SOURCE,
  DRAWING_LABEL_SOURCE,
  DRAWING_LAYER_IDS,
  DRAWING_SOURCE,
  buildDrawingLayerSpecs,
  drawingsToGeoJson,
  draftToGeoJson,
  labelPointsToGeoJson,
  polygonFromVertices,
} from "./drawing-style";

const drawing = (patch: Partial<Drawing> = {}): Drawing => ({
  id: "drawing:1",
  source: "agent",
  kind: "polygon",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.5, 25],
        [121.6, 25],
        [121.6, 25.1],
        [121.5, 25],
      ],
    ],
  },
  ...patch,
});

describe("drawingsToGeoJson", () => {
  it("carries source and kind as properties so the layers can filter on them", () => {
    const [feature] = drawingsToGeoJson([drawing({ source: "user", kind: "line" })]).features;
    expect(feature.properties).toMatchObject({ id: "drawing:1", source: "user", kind: "line" });
  });

  it("omits label entirely when the drawing has none", () => {
    // The source mirrors the store: a drawing without a label must not gain a
    // key holding undefined or "", which anything reading the source back -
    // a filter, a debug query - would treat as a value the user never set.
    const [feature] = drawingsToGeoJson([drawing()]).features;
    expect(feature.properties).not.toHaveProperty("label");
    const [labelled] = drawingsToGeoJson([drawing({ label: "walkable" })]).features;
    expect(labelled.properties?.label).toBe("walkable");
  });

  it("keeps the geometry the store holds, untouched", () => {
    // Tools query the same geometry they wrote; re-projecting or rounding here
    // would make the drawn shape and the queried shape disagree.
    const source = drawing();
    const [feature] = drawingsToGeoJson([source]).features;
    expect(feature.geometry).toEqual(source.geometry);
  });
});

describe("buildDrawingLayerSpecs", () => {
  const specs = buildDrawingLayerSpecs();

  it("renders agent and user outlines differently", () => {
    // "Who drew this?" is the point of the demo, so the two sources must not
    // be told apart by colour alone.
    const agent = specs.find((l) => l.id === "gm-drawing-line-agent");
    const user = specs.find((l) => l.id === "gm-drawing-line-user");
    const dash = (layer: typeof agent) =>
      (layer as { paint?: Record<string, unknown> }).paint?.["line-dasharray"];
    expect(dash(agent)).toBeDefined();
    expect(dash(user)).toBeUndefined();
  });

  it("fills polygons only, so a line drawing is not rendered as an area", () => {
    const fill = specs.find((l) => l.id === "gm-drawing-fill");
    expect((fill as { filter?: unknown }).filter).toEqual(["==", ["geometry-type"], "Polygon"]);
  });

  it("reads from the drawing sources only", () => {
    const sources = new Set(specs.map((l) => (l as { source?: string }).source));
    expect(sources).toEqual(new Set([DRAWING_SOURCE, DRAWING_LABEL_SOURCE, DRAFT_SOURCE]));
  });

  it("can be tapped on every layer a finished shape paints, and on no other", () => {
    // The taps are what make a hand-drawn shape removable without an agent
    // (`OnTheMapCard`), so a renamed layer must fail here rather than silently
    // stop answering. The label is left out on purpose — a symbol's hit box is
    // its glyphs — and so is the draft, which is not a mark yet.
    const painted = specs
      .filter((l) => (l as { source?: string }).source === DRAWING_SOURCE)
      .map((l) => l.id);
    expect([...DRAWING_LAYER_IDS]).toEqual(painted.filter((id) => id !== "gm-drawing-label"));
  });

  it("labels from the point source, not from the shapes", () => {
    // Labelling the shapes directly repeats the label in every tile the shape
    // covers, so a big circle gets its name printed several times.
    const label = specs.find((l) => l.id === "gm-drawing-label");
    expect((label as { source?: string }).source).toBe(DRAWING_LABEL_SOURCE);
  });
});

describe("labelPointsToGeoJson", () => {
  it("emits exactly one point per labelled drawing", () => {
    const collection = labelPointsToGeoJson([
      drawing({ id: "drawing:1", label: "walkable" }),
      drawing({ id: "drawing:2" }),
    ]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties).toMatchObject({ id: "drawing:1", label: "walkable" });
    expect(collection.features[0].geometry.type).toBe("Point");
  });

  it("anchors a circle on its own centre, not on its polygon approximation", () => {
    const centre: LngLat = [121.5, 25];
    const collection = labelPointsToGeoJson([
      drawing({ kind: "circle", label: "800 m", center: centre, radius_m: 800 }),
    ]);
    expect(collection.features[0].geometry).toMatchObject({ coordinates: centre });
  });

  it("anchors other shapes inside their own extent", () => {
    const [feature] = labelPointsToGeoJson([drawing({ label: "area" })]).features;
    const [lng, lat] = (feature.geometry as { coordinates: number[] }).coordinates;
    expect(lng).toBeGreaterThan(121.5);
    expect(lng).toBeLessThan(121.6);
    expect(lat).toBeGreaterThan(25);
    expect(lat).toBeLessThan(25.1);
  });
});

describe("polygonFromVertices", () => {
  const square: LngLat[] = [
    [121.5, 25],
    [121.6, 25],
    [121.6, 25.1],
  ];

  it("closes the ring so the result is a valid GeoJSON polygon", () => {
    const polygon = polygonFromVertices(square);
    const ring = polygon!.coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("refuses fewer than three distinct corners", () => {
    // Finishing a draft too early must leave the store untouched rather than
    // store a shape that contains nothing.
    expect(polygonFromVertices([])).toBeNull();
    expect(polygonFromVertices([[121.5, 25]])).toBeNull();
    expect(
      polygonFromVertices([
        [121.5, 25],
        [121.6, 25],
      ]),
    ).toBeNull();
  });

  it("ignores a repeated click on the same point", () => {
    // A double-click to finish lands two clicks on one spot; that must not
    // turn a valid triangle into a degenerate ring.
    const repeated: LngLat[] = [
      [121.5, 25],
      [121.5, 25],
      [121.6, 25],
      [121.6, 25.1],
      [121.6, 25.1],
    ];
    expect(polygonFromVertices(repeated)).toEqual(polygonFromVertices(square));
  });

  it("is null when the repeats leave fewer than three corners", () => {
    expect(
      polygonFromVertices([
        [121.5, 25],
        [121.5, 25],
        [121.6, 25],
      ]),
    ).toBeNull();
  });
});

describe("draftToGeoJson", () => {
  it("shows every vertex clicked so far", () => {
    const points = draftToGeoJson([
      [121.5, 25],
      [121.6, 25],
    ]).features.filter((f) => f.geometry.type === "Point");
    expect(points).toHaveLength(2);
  });

  it("closes the preview from three vertices on, matching what gets stored", () => {
    // What the user sees while drawing has to be the shape the store receives,
    // otherwise the finished polygon jumps on the last click.
    const vertices: LngLat[] = [
      [121.5, 25],
      [121.6, 25],
      [121.6, 25.1],
    ];
    const preview = draftToGeoJson(vertices).features.find((f) => f.geometry.type === "Polygon");
    expect(preview?.geometry).toEqual(polygonFromVertices(vertices));
    const line = draftToGeoJson(vertices).features.find((f) => f.geometry.type === "LineString");
    expect(line?.geometry).toMatchObject({ coordinates: [...vertices, vertices[0]] });
  });

  it("draws no band and no area for a single vertex", () => {
    const kinds = draftToGeoJson([[121.5, 25]]).features.map((f) => f.geometry.type);
    expect(kinds).toEqual(["Point"]);
  });

  it("is empty when nothing has been clicked", () => {
    expect(draftToGeoJson([]).features).toEqual([]);
  });
});
