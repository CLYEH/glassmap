import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import { resolveSelection } from "./selection-model";

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
});
