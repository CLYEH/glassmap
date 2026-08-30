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
    expect(rows[1]).toEqual({ id: "osm:way:404", name: "osm:way:404", category: null, sample: false });
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
        { id: "osm:node:77", name: "cafe osm:node:77", category: "cafe", sample: false },
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
});
