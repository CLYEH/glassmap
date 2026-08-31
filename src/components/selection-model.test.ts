import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { MapFeature } from "@/lib/store/tier2";
import { resolveSelection } from "./selection-model";

const poi = (id: string, patch: Partial<MapFeature["properties"]> = {}): MapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [121.54, 25.03] },
  properties: { id, name: `cafe ${id}`, category: "cafe", source: "osm", ...patch },
});

const feature = (
  id: string,
  patch: Partial<GlassMapFeature["properties"]> = {},
): GlassMapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [121.5, 25] },
  properties: {
    id,
    name: `name of ${id}`,
    category: "mrt_station",
    source: "osm",
    ...patch,
  },
});

describe("resolveSelection", () => {
  const features = [feature("osm:node:1"), feature("listing:02", { category: "listing", source: "sample", sample: true })];

  it("names the selected features in the order the store holds them", () => {
    // The sidebar is how a human checks what an agent just selected, so the
    // order has to be the agent's order, not the dataset's.
    const rows = resolveSelection(features, ["listing:02", "osm:node:1"]);
    expect(rows.map((r) => r.id)).toEqual(["listing:02", "osm:node:1"]);
    expect(rows[1]).toMatchObject({ name: "name of osm:node:1", category: "mrt_station" });
  });

  it("keeps ids it cannot resolve, so the list length always matches selection-count", () => {
    // Tools may select before the GeoJSON has loaded. Dropping the row would
    // make the sidebar disagree with the count the overlay and get_map_state
    // report.
    const rows = resolveSelection(features, ["osm:node:1", "osm:way:404"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      id: "osm:way:404",
      name: "osm:way:404",
      category: null,
      sample: false,
      details: [],
      bounds: null,
    });
  });

  it("flags fabricated listings so the UI can label them", () => {
    expect(resolveSelection(features, ["listing:02"])[0].sample).toBe(true);
    expect(resolveSelection(features, ["osm:node:1"])[0].sample).toBe(false);
  });

  it("falls back to the id when a feature has an empty name", () => {
    const rows = resolveSelection([feature("osm:node:9", { name: "" })], ["osm:node:9"]);
    expect(rows[0].name).toBe("osm:node:9");
  });

  it("is empty for an empty selection", () => {
    expect(resolveSelection(features, [])).toEqual([]);
  });

  describe("point-of-interest features", () => {
    // The store keeps POIs out of `features` on purpose (the map draws the six
    // bundled datasets), but a selected cafe is still a selected feature. Read
    // from `features` alone the sidebar showed a raw `osm:node:…` id labelled
    // "not loaded" for the place the agent had just named.
    it("names a selected POI and reports its category", () => {
      const rows = resolveSelection([], ["osm:node:77"], [poi("osm:node:77")]);
      expect(rows).toEqual([
        {
          id: "osm:node:77",
          name: "cafe osm:node:77",
          category: "cafe",
          sample: false,
          details: [],
          bounds: [121.54, 25.03, 121.54, 25.03],
        },
      ]);
    });

    it("keeps the store's order across both tiers", () => {
      const rows = resolveSelection(features, ["osm:node:77", "osm:node:1"], [poi("osm:node:77")]);
      expect(rows.map((r) => r.category)).toEqual(["cafe", "mrt_station"]);
    });

    it("falls back to the English name, then the id, for a nameless POI", () => {
      // OSM has plenty of unnamed car parks and bike docks; they are still
      // places, and the row has to say something a person can read.
      const named = resolveSelection([], ["a"], [poi("a", { name: "", nameEn: "Daan Park" })]);
      expect(named[0].name).toBe("Daan Park");
      const bare = resolveSelection([], ["b"], [poi("b", { name: "" })]);
      expect(bare[0].name).toBe("b");
    });

    it("lets a bundled feature win a shared id", () => {
      // `appendTier2Features` gives the bundled datasets the same precedence,
      // so the row and the map must not disagree about what the id is.
      const rows = resolveSelection(features, ["osm:node:1"], [poi("osm:node:1")]);
      expect(rows[0].category).toBe("mrt_station");
    });

    it("still says 'not loaded' for an id neither tier has", () => {
      expect(resolveSelection(features, ["osm:way:404"], [poi("osm:node:77")])[0].category).toBe(
        null,
      );
    });
  });

  /**
   * The names and tags both human surfaces read. The sidebar shows the pair of
   * names, the tap card shows the pair plus the tags — one resolution, so the
   * card and the list can never call the same place two different things.
   */
  describe("what a human is shown about a place", () => {
    it("carries the English name as a second name, not as a replacement", () => {
      // The name on the door stays the headline. Taipei OSM data is zh-TW
      // first, and a page that showed only "Kebuke" would name a shop nobody
      // in the street is looking at.
      const rows = resolveSelection([], ["a"], [poi("a", { name: "可不可熟成紅茶", nameEn: "Kebuke" })]);
      expect(rows[0]).toMatchObject({ name: "可不可熟成紅茶", nameEn: "Kebuke" });
    });

    it("prints one name when both names are the same string", () => {
      // 32 of the shipped cafes have `name === nameEn`, and a nameless POI is
      // *given* its English name as the headline — printing it twice would
      // make the card look broken.
      expect(resolveSelection([], ["a"], [poi("a", { name: "Fika Fika", nameEn: "Fika Fika" })])[0])
        .not.toHaveProperty("nameEn");
      expect(
        resolveSelection([], ["b"], [poi("b", { name: "", nameEn: "Daan Park" })])[0],
      ).not.toHaveProperty("nameEn");
    });

    it("carries the tags the tools return, so the card can show them", () => {
      // The whole of T-96: `describeFeature` has always put these in the
      // agent's answer, and the human's own row could not see them.
      const rows = resolveSelection(
        [],
        ["a"],
        [poi("a", { cuisine: "bubble_tea", opening_hours: "Mo-Su 11:00-23:00" })],
      );
      expect(rows[0].details.map((d) => [d.field, d.text])).toEqual([
        ["cuisine", "bubble_tea"],
        ["opening_hours", "Mo-Su 11:00-23:00"],
      ]);
    });

    it("has nothing to add about a bundled feature or an unknown id", () => {
      // The six bundled datasets carry none of these tags, and neither does an
      // id nothing has loaded: both render a card with no details section.
      expect(resolveSelection(features, ["osm:node:1"])[0].details).toEqual([]);
      expect(resolveSelection(features, ["osm:way:404"])[0].details).toEqual([]);
    });
  });

  /**
   * T-101: a sidebar row is clickable, and `bounds` is what decides whether it
   * can be. A row that offered to fly to a place it cannot locate would be the
   * one lie this panel has never told — so the box is read from the feature's
   * own geometry, and its absence is the row's honest "not loaded".
   */
  describe("where the row is", () => {
    it("boxes a point feature at its own coordinate, which is not an extent", () => {
      // A point has nothing to frame, and the framing has to be able to tell:
      // west === east and south === north is exactly how `frame-model` decides
      // to keep the person's zoom instead of fitting.
      const rows = resolveSelection([], ["a"], [poi("a")]);
      expect(rows[0].bounds).toEqual([121.54, 25.03, 121.54, 25.03]);
    });

    it("boxes an area feature so a click can frame the whole of it", () => {
      const district: MapFeature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [121.5, 25.0],
              [121.56, 25.0],
              [121.56, 25.04],
              [121.5, 25.04],
              [121.5, 25.0],
            ],
          ],
        },
        properties: { id: "osm:way:7", name: "Daan", category: "district", source: "osm" },
      };
      const rows = resolveSelection([], ["osm:way:7"], [district]);
      expect(rows[0].bounds).toEqual([121.5, 25.0, 121.56, 25.04]);
    });

    it("has no box for an id nothing has loaded — the row that cannot be flown to", () => {
      // Share-restore leftovers land here: the row still renders and can still
      // be deselected, but there is nowhere to point a camera.
      expect(resolveSelection(features, ["osm:way:404"])[0].bounds).toBeNull();
    });
  });
});
