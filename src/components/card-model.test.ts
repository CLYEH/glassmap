import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { Annotation, Drawing } from "@/lib/store/map-store";
import type { MapFeature } from "@/lib/store/tier2";
import {
  CARD_COPY,
  CARD_GAP_PX,
  CARD_NOTE_CHARS,
  CARD_TOP_MARGIN_PX,
  cardPlacement,
  cardProvenance,
  cardView,
  type CardSubjects,
} from "./card-model";

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

/**
 * Where the card hangs. This used to be a constant (190px, "roughly the card's
 * own height") and the details section falsified it on arrival: a taller card
 * kept choosing "above" for taps that could not fit one, and put the name off
 * the top of the map — the one place a human cannot see that anything is
 * wrong. What these tests hold is that the answer is a function of the height
 * the card actually has, so no field added later can quietly re-stale it.
 */
describe("cardPlacement", () => {
  /** The measured height of a bilingual card with three tag rows, at 1440x900. */
  const THREE_ROW = 235;

  it("hangs the card under the tap when there is not room for it above", () => {
    // The regression, at the number it was measured at: 200px down the map,
    // 235px of card. Above the tap it would start at −51.
    expect(cardPlacement(200, THREE_ROW)).toBe("below");
    // And the old constant's whole dead band, which said "above" for all of it.
    expect(cardPlacement(190, THREE_ROW)).toBe("below");
    expect(cardPlacement(250, THREE_ROW)).toBe("below");
  });

  it("hangs it above as soon as the card fits, and not one pixel sooner", () => {
    const fits = THREE_ROW + CARD_GAP_PX + CARD_TOP_MARGIN_PX;
    expect(cardPlacement(fits, THREE_ROW)).toBe("above");
    expect(cardPlacement(fits - 1, THREE_ROW)).toBe("below");
  });

  it("moves its own boundary when the card grows", () => {
    // T-97 adds address, phone, wheelchair and website to the same section.
    // A shorter card still fits where a taller one does not — which is the
    // whole reason this reads a measurement instead of a constant.
    const short = 150;
    expect(cardPlacement(200, short)).toBe("above");
    expect(cardPlacement(200, THREE_ROW)).toBe("below");
    expect(cardPlacement(200, THREE_ROW + 172)).toBe("below");
  });

  it("still flips at the right pixel for the tallest card the data can build", () => {
    /*
     * T-97 landed, and this is the measurement that says the design held.
     *
     * `SEVEN_ROW` is a real card in a real browser: 伯朗咖啡館 / Mr. Brown
     * (`osm:node:2136854023`), the richest place in the shipped extract — seven
     * of the fourteen tags, and a second name under the headline. It measures
     * 238x346 at 1440x900, 111px taller than the three-row card this file was
     * written against, and every one of those pixels came from a table this
     * suite can grow again tomorrow.
     *
     * Which is the point: 346 is not a constant the code consults, it is what
     * the DOM reported and what `CardBody` asked this function about. The
     * numbers below were then confirmed against the rendered card — a tap at
     * 370 puts its top edge at exactly CARD_TOP_MARGIN_PX, at 369 it hangs
     * below, and a tap 120px down the map hangs below with room to spare.
     */
    const SEVEN_ROW = 346;
    expect(cardPlacement(SEVEN_ROW + CARD_GAP_PX + CARD_TOP_MARGIN_PX, SEVEN_ROW)).toBe("above");
    expect(cardPlacement(SEVEN_ROW + CARD_GAP_PX + CARD_TOP_MARGIN_PX - 1, SEVEN_ROW)).toBe("below");
    expect(cardPlacement(120, SEVEN_ROW)).toBe("below");
    // The regression this whole mechanism exists for: the constant it replaced
    // was 190px, so every tap from 190 to 361 would have chosen "above" and put
    // the name — and the English name under it — off the top of the map.
    expect(cardPlacement(360, SEVEN_ROW)).toBe("below");
    // A three-row card still fits at a tap the seven-row one cannot: the answer
    // follows the card, not the field list.
    expect(cardPlacement(300, THREE_ROW)).toBe("above");
    expect(cardPlacement(300, SEVEN_ROW)).toBe("below");
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

  it("tells a human what the tools already say about a place", () => {
    // The tap card is where a person meets a POI. `describeFeature` returns
    // cuisine, brand and opening_hours to the agent for exactly this place;
    // before T-96 the card beside the human's finger said "Cafe" and a name.
    const cafe: MapFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [121.54, 25.03] },
      properties: {
        id: "osm:node:77",
        name: "路易莎咖啡",
        nameEn: "Louisa Coffee",
        category: "cafe",
        source: "osm",
        cuisine: "coffee_shop",
        brand: "路易莎咖啡",
        opening_hours: "Mo-Su 07:00-21:00",
      },
    };
    const view = cardView(
      { kind: "feature", id: "osm:node:77", x: 5, y: 5 },
      subjects({ features: [], tier2Features: [cafe] }),
    );
    expect(view).toMatchObject({ name: "路易莎咖啡", nameEn: "Louisa Coffee", what: "Cafe" });
    // Brand is dropped: it is the headline, character for character. The card
    // says every distinct thing the source has, and says nothing twice.
    expect(view?.details.map((d) => [d.label, d.text])).toEqual([
      ["Cuisine", "coffee_shop"],
      ["Hours", "Mo-Su 07:00-21:00"],
    ]);
  });

  it("puts everything get_place_details can answer on the card beside the finger", () => {
    /*
     * The parity rule at its widest, on the richest place in the shipped
     * extract (`osm:node:2136854023`, seven of the fourteen tags). Before T-97
     * an agent could read this place its address, its phone number and whether
     * anyone had recorded a ramp, while the card under the human's own finger
     * showed three tags and a name. Whatever the tool can say, the card says.
     */
    const cafe: MapFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [121.53634, 25.05176] },
      properties: {
        id: "osm:node:2136854023",
        name: "伯朗咖啡館",
        nameEn: "Mr. Brown",
        category: "cafe",
        source: "osm",
        cuisine: "coffee_shop",
        brand: "Mr. Brown 伯朗咖啡館",
        opening_hours: "Mo-Fr 07:00-22:00; Sa-Su 07:30-22:00",
        address: "10489臺北市中山區南京東路二段218號",
        phone: "+886 2 2507 3600",
        website: "https://www.mrbrown.com.tw/",
        wheelchair: "yes",
      },
    };
    const view = cardView(
      { kind: "feature", id: "osm:node:2136854023", x: 5, y: 5 },
      subjects({ features: [], tier2Features: [cafe] }),
    );
    expect(view?.details.map((d) => [d.label, d.text])).toEqual([
      ["Cuisine", "coffee_shop"],
      // Kept, unlike the Louisa case above: this brand is neither of the two
      // names printed over it, so dropping it would delete the chain.
      ["Brand", "Mr. Brown 伯朗咖啡館"],
      ["Hours", "Mo-Fr 07:00-22:00; Sa-Su 07:30-22:00"],
      ["Address", "10489臺北市中山區南京東路二段218號"],
      ["Phone", "+886 2 2507 3600"],
      ["Website", "https://www.mrbrown.com.tw/"],
      // The tag, not a claim about the door. See `feature-details.ts`.
      ["Wheelchair", "yes"],
    ]);
    // Only the website is followable, and only because it is a web URL.
    expect(view?.details.filter((d) => d.href).map((d) => [d.field, d.href])).toEqual([
      ["website", "https://www.mrbrown.com.tw/"],
    ]);
  });

  it("has no details and no second name for a place the data barely knows", () => {
    // A bundled feature carries none of the POI tags, so the section is empty
    // and the component renders nothing rather than an empty box.
    const view = cardView({ kind: "feature", id: "park:1", x: 1, y: 2 }, subjects());
    expect(view?.details).toEqual([]);
    expect(view).not.toHaveProperty("nameEn");
  });

  it("keeps notes and shapes free of a details section", () => {
    // Both are one person's words about a point, not a place with tags. The
    // type says so too — `details` is always the empty array for these.
    expect(cardView({ kind: "annotation", id: "annotation:1", x: 1, y: 2 }, subjects())?.details)
      .toEqual([]);
    expect(cardView({ kind: "drawing", id: "drawing:1", x: 1, y: 2 }, subjects())?.details).toEqual(
      [],
    );
  });

  it("resolves to nothing once the mark has been removed", () => {
    // The race the card has to lose gracefully: a tool removes the note a
    // human is reading about. Rendering nothing is what keeps the card from
    // offering to remove it a second time.
    expect(cardView({ kind: "annotation", id: "annotation:9", x: 1, y: 2 }, subjects())).toBeNull();
    expect(cardView({ kind: "drawing", id: "drawing:9", x: 1, y: 2 }, subjects())).toBeNull();
  });
});
