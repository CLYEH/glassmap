import { describe, expect, it } from "vitest";
import { TIER2_CATEGORIES } from "@/lib/store/tier2";
import { TIER2_PLURAL } from "./category-labels";
import { TRAY_ORDER, trayCount } from "./places-model";

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
    // The real manifest's numbers: cafés 2,297, banks 1,576, restaurants
    // 13,819 — the counts the design's own tray frame shows.
    expect(trayCount(2297)).toBe("2.3k");
    expect(trayCount(1576)).toBe("1.6k");
    expect(trayCount(13819)).toBe("13.8k");
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
