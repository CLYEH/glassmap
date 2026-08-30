import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { Annotation, Drawing } from "@/lib/store/map-store";
import { CARD_COPY, CARD_NOTE_CHARS, cardProvenance, cardView, type CardSubjects } from "./card-model";

/**
 * The card is the one surface where a human is told, in a whole sentence, who
 * put a mark on their map. Three of these sentences are possible for a place
 * and exactly one of them is a hedge — which one, and when, is the whole of
 * design2-v5 §2.5, and it is the difference between a page that reports
 * provenance and a page that invents it.
 */
describe("cardProvenance", () => {
  it("says the human tapped it only when the store recorded that they did", () => {
    // The click path writes `"user"` (MapCanvas's toggle). Nothing else may
    // produce this sentence: it is the only one that credits a person by name.
    expect(cardProvenance("user", false)).toBe("user");
    expect(cardProvenance("user", true)).toBe("user");
    expect(CARD_COPY.feature.user.line).toContain("you tapped it");
  });

  it("names the agent when the record says so, whatever the link said", () => {
    expect(cardProvenance("agent", false)).toBe("agent");
    expect(CARD_COPY.feature.agent.line).toContain("the agent selected it");
  });

  it("names the agent for an unrecorded id when the link carried `su`", () => {
    // `su` states the human's ids, so the complement is the sender's recorded
    // agent selection. Inference, but from evidence the wire actually carried.
    expect(cardProvenance(undefined, true)).toBe("agent");
  });

  it("hedges to the link when nothing on this page or the wire ever claimed it", () => {
    // A `su`-less link is one indistinguishable wire state — legacy, or
    // all-agent from the new encoder. The bead stays teal (Ruling 3's safe
    // direction, applied by the bead layer); only the sentence backs off, so
    // the page never asserts a fact it was not told.
    expect(cardProvenance(undefined, false)).toBe("link");
    expect(CARD_COPY.feature.link.line).toContain("from a shared link");
    expect(CARD_COPY.feature.link.line).not.toContain("agent");
  });
});

const park: GlassMapFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [121.5, 25.03] },
  properties: { id: "park:1", name: "Da'an Forest Park", category: "park" },
} as GlassMapFeature;

const note: Annotation = {
  id: "annotation:1",
  source: "user",
  at: [121.5, 25.03],
  note: "quiet street, good light",
};

const circle: Drawing = {
  id: "drawing:1",
  source: "agent",
  kind: "circle",
  label: "10-min walk",
  geometry: { type: "Polygon", coordinates: [[]] },
  center: [121.5, 25.03],
  radius_m: 799.6,
};

const subjects = (patch: Partial<CardSubjects> = {}): CardSubjects => ({
  features: [park],
  tier2Features: [],
  annotations: [note],
  drawings: [circle],
  selectionSources: {},
  selectionAttributionExplicit: false,
  ...patch,
});

/**
 * What the card resolves a tap into. This is the model behind the one-way door
 * the human chrome used to have: a person with no agent could pin a note and
 * draw a shape, and nothing on the page could take either back. Every mark has
 * to resolve to a card with a Remove, and a mark that is gone has to resolve to
 * nothing at all.
 */
describe("cardView", () => {
  it("answers for a place the human tapped", () => {
    const view = cardView(
      { kind: "feature", id: "park:1", x: 10, y: 20 },
      subjects({ selectionSources: { "park:1": "user" } }),
    );
    expect(view).toMatchObject({
      kind: "feature",
      name: "Da'an Forest Park",
      what: "Park",
      provenance: "user",
    });
  });

  it("answers for a note, in the note's own words and its own provenance", () => {
    // A note carries `source` in the store and `o` on the wire, so the card
    // never has to hedge about one — it says who pinned it, as a fact.
    const view = cardView({ kind: "annotation", id: "annotation:1", x: 1, y: 2 }, subjects());
    expect(view).toMatchObject({
      kind: "annotation",
      name: "quiet street, good light",
      what: "Note",
      provenance: "user",
    });
    expect(view?.copy.line).toContain("you pinned it");
  });

  it("clips a long note to a headline instead of growing the card", () => {
    const long = "x".repeat(CARD_NOTE_CHARS * 2);
    const view = cardView(
      { kind: "annotation", id: "annotation:1", x: 1, y: 2 },
      subjects({ annotations: [{ ...note, note: long }] }),
    );
    expect(view?.name).toHaveLength(CARD_NOTE_CHARS);
    expect(view?.name.endsWith("…")).toBe(true);
  });

  it("answers for a shape with its label, its size and who drew it", () => {
    const view = cardView({ kind: "drawing", id: "drawing:1", x: 1, y: 2 }, subjects());
    expect(view).toMatchObject({ kind: "drawing", name: "10-min walk", what: "Circle · 800 m" });
    expect(view?.copy.line).toContain("the agent drew it");
  });

  it("names an unlabelled shape by what it is", () => {
    const view = cardView(
      { kind: "drawing", id: "drawing:2", x: 1, y: 2 },
      subjects({
        drawings: [
          {
            id: "drawing:2",
            source: "user",
            kind: "polygon",
            geometry: { type: "Polygon", coordinates: [[]] },
          },
        ],
      }),
    );
    expect(view).toMatchObject({ name: "Polygon", what: "Polygon", provenance: "user" });
  });

  it("resolves to nothing once the mark has been removed", () => {
    // The race the card has to lose gracefully: a tool removes the note a
    // human is reading about. Rendering nothing is what keeps the card from
    // offering to remove it a second time.
    expect(cardView({ kind: "annotation", id: "annotation:9", x: 1, y: 2 }, subjects())).toBeNull();
    expect(cardView({ kind: "drawing", id: "drawing:9", x: 1, y: 2 }, subjects())).toBeNull();
  });
});
