import { describe, expect, it } from "vitest";
import { FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { TIER2_CATEGORIES } from "@/lib/store/tier2";
import { LEGEND_ORDER, TIER2_PLURAL } from "./category-labels";
import { TRAY_ORDER, bundledKeyRows, trayCount } from "./places-model";

const feature = (id: string, category: FeatureCategory): GlassMapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [121.54, 25.03] },
  properties: { id, name: id, category, source: "osm" },
});

/**
 * The Places tray is the human half of the tier-2 data: eighteen rows that
 * turn "an agent could load the city's cafés" into a tap. What it must never
 * do is overstate what is there — a menu that rounds 999 up to "1k" is
 * advertising a hundred places that do not exist — or reorder itself, since
 * the whole point of a menu is that the same word is in the same place twice.
 */
describe("trayCount", () => {
  it("prints small counts exactly", () => {
    expect(trayCount(0)).toBe("0");
    expect(trayCount(497)).toBe("497");
    expect(trayCount(999)).toBe("999");
  });

  it("never rounds a category up past a thousand it does not have", () => {
    // 999 is the boundary: "1k" here would be the tray claiming more than the
    // manifest counts, which is the one direction this number may never move.
    expect(trayCount(999)).not.toContain("k");
    expect(trayCount(1000)).toBe("1k");
  });

  it("rounds thousands to one decimal and drops a bare .0", () => {
    // The real manifest's numbers: cafés 2,298, banks 1,576, restaurants
    // 13,789 — the counts the design's own tray frame shows.
    expect(trayCount(2298)).toBe("2.3k");
    expect(trayCount(1576)).toBe("1.6k");
    expect(trayCount(13789)).toBe("13.8k");
    expect(trayCount(2000)).toBe("2k");
  });
});

describe("TRAY_ORDER", () => {
  it("offers every category the tools can load, and no others", () => {
    // A tray that is missing one is a category no human can reach without an
    // agent, which is the exact gap this component exists to close.
    expect([...TRAY_ORDER].sort()).toEqual([...TIER2_CATEGORIES].sort());
  });

  it("is sorted by the word a person reads, not by the OSM tag", () => {
    // `place_of_worship` reads "Worship" and belongs at the end; sorting by
    // the enum would file it under P, where nobody would look for it.
    const labels = TRAY_ORDER.map((c) => TIER2_PLURAL[c]);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
    expect(labels[labels.length - 1]).toBe("Worship");
  });
});

/**
 * The key half of the tray — what the coloured dots mean, and how many of each
 * the map is holding. It is the one place on screen that claims to explain the
 * paint, so its rows have to be the paint: every colour the map can draw, and
 * counts that add up to the total the dock pill states beside them. A key that
 * silently dropped a colour, or one whose rows summed to something other than
 * the advertised total, would be a confident answer to "what am I looking at?"
 * that is not true.
 */
describe("bundledKeyRows", () => {
  it("explains every colour the map can paint, in legend order", () => {
    // Even with nothing loaded: the rows are a key to the six datasets, not a
    // report on the ones that happen to be present, and a colour with no line
    // beside it is a dot nobody can name.
    expect(bundledKeyRows([]).map((row) => row.category)).toEqual([...LEGEND_ORDER]);
    expect(bundledKeyRows([]).every((row) => row.count === 0)).toBe(true);
  });

  it("covers every bundled category, so no painted dot is left unexplained", () => {
    expect([...LEGEND_ORDER].sort()).toEqual([...FEATURE_CATEGORIES].sort());
  });

  it("counts what the store holds, category by category", () => {
    const rows = bundledKeyRows([
      feature("a", "park"),
      feature("b", "park"),
      feature("c", "district"),
    ]);
    const byCategory = new Map(rows.map((row) => [row.category, row.count]));
    expect(byCategory.get("park")).toBe(2);
    expect(byCategory.get("district")).toBe(1);
    expect(byCategory.get("school")).toBe(0);
  });

  it("adds up to the total the dock pill prints", () => {
    // The honesty rule of the whole surface: the pill says "Places · N" from
    // `features.length`, and these rows are the account of that N. If the two
    // could disagree, one of them would be lying about the map.
    const features = [
      feature("a", "park"),
      feature("b", "supermarket"),
      feature("c", "school"),
      feature("d", "mrt_station"),
      feature("e", "listing"),
      feature("f", "district"),
      feature("g", "park"),
    ];
    const sum = bundledKeyRows(features).reduce((total, row) => total + row.count, 0);
    expect(sum).toBe(features.length);
  });
});
