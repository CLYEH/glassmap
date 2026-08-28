import { describe, expect, it } from "vitest";
import type { GlassMapFeature } from "@/lib/data/schema";
import { buildGazetteer, resolvePlace, resolvePlaceOne, stripPlaceSuffix } from "./gazetteer";
import { FIXTURE_FEATURES, VIEW } from "./test-fixtures";

const ids = (query: string) => resolvePlace(query, FIXTURE_FEATURES).map((m) => m.id);

describe("stripPlaceSuffix", () => {
  it("removes station wording in both languages so users need not type it", () => {
    expect(stripPlaceSuffix("Daan Station")).toBe("daan");
    expect(stripPlaceSuffix("大安站")).toBe("大安");
    expect(stripPlaceSuffix("台北車站")).toBe("台北");
    expect(stripPlaceSuffix("MRT Daan")).toBe("daan");
  });

  it("does not eat the meaningful part of a longer suffix", () => {
    // Cutting 站 alone would leave 大安森林公園捷運, which matches nothing.
    expect(stripPlaceSuffix("大安森林公園捷運站")).toBe("大安森林公園");
  });

  it("leaves non-station names alone, so 'Park' stays part of the name", () => {
    expect(stripPlaceSuffix("Daan Forest Park")).toBe("daan forest park");
  });
});

describe("punctuation folding", () => {
  /*
   * OSM romanises 大安 as "Da-an" in the park and "Da'an" in the district while
   * every human types "Daan". Before folding, both of these returned "unknown
   * place" against the real dataset — the tool looked broken for the most
   * obvious query in the demo.
   */
  it("matches a hyphenated OSM name typed without the hyphen", () => {
    expect(resolvePlaceOne("Daan Forest Park", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "osm:way:10", nameEn: "Da-an Forest Park" },
    });
  });

  it("matches an apostrophised OSM name typed without the apostrophe", () => {
    expect(resolvePlaceOne("Daan District", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "district:daan", nameEn: "Da'an District" },
    });
  });

  it("still matches when the punctuation is typed, in either style", () => {
    expect(ids("Da-an Forest Park")).toContain("osm:way:10");
    expect(ids("Da'an Forest Park")).toContain("osm:way:10");
    expect(ids("Da’an District")).toContain("district:daan");
  });
});

describe("resolvePlace ranking", () => {
  it("ranks an exact name above everything that merely starts with it", () => {
    // The station is named exactly 大安 / "Daan"; the park, the park station
    // and the district only begin with it.
    const ranked = resolvePlace("Daan", FIXTURE_FEATURES);
    expect(ranked[0].id).toBe("osm:node:2");
    expect(ranked[0].score).toBe(4);
    expect(ranked.slice(1).every((m) => m.score < 4)).toBe(true);
  });

  it("prefers a name as written over one that only matches after stripping", () => {
    // Constructed, not from the dataset: no real place is named 台北 on its own.
    // The rule still matters, because a station suffix must never let 台北車站
    // outrank something actually called 台北.
    const taipeiPark: GlassMapFeature = {
      type: "Feature",
      properties: { id: "test:taipei", name: "台北", category: "park", source: "osm" },
      geometry: { type: "Point", coordinates: [121.52, 25.05] },
    };
    const ranked = resolvePlace("台北", [...FIXTURE_FEATURES, taipeiPark]);
    expect(ranked[0].id).toBe("test:taipei");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].id).toBe("osm:node:1");
  });

  it("matches the local name and the English name of the same feature", () => {
    expect(ids("台北車站")).toContain("osm:node:1");
    expect(ids("taipei main station")).toContain("osm:node:1");
    expect(ids("TAIPEI")).toContain("osm:node:1");
  });

  it("returns nothing for a blank or unknown query instead of guessing", () => {
    expect(resolvePlace("   ", FIXTURE_FEATURES)).toEqual([]);
    expect(resolvePlace("Shibuya", FIXTURE_FEATURES)).toEqual([]);
  });

  it("indexes every named feature, including sample listings", () => {
    expect(buildGazetteer(FIXTURE_FEATURES)).toHaveLength(FIXTURE_FEATURES.length);
    expect(ids("Sample listing")).toEqual(["listing:01"]);
  });
});

describe("resolvePlaceOne", () => {
  it("commits to a single best match", () => {
    expect(resolvePlaceOne("228 Peace Park", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "osm:way:11" },
    });
    // "Daan Park" is the station's exact English name; the park is called
    // "Da-an Forest Park", which neither equals nor starts with it.
    expect(resolvePlaceOne("Daan Park", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "osm:node:3" },
    });
  });

  it("admits that a station and the park it serves share one name", () => {
    // Both are called 大安森林公園 in OSM. Picking either would be a guess.
    const r = resolvePlaceOne("大安森林公園", FIXTURE_FEATURES);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["osm:node:3", "osm:way:10"]);
    expect(r.candidates.map((c) => c.category).sort()).toEqual(["mrt_station", "park"]);
  });

  it("refuses to pick between two branches of the same chain", () => {
    // A wrong guess is invisible to an agent that cannot see the map, so two
    // equally good matches must come back as a question, not an answer.
    const r = resolvePlaceOne("Pxmart", FIXTURE_FEATURES);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    // Without an origin there is nothing to measure from, so no distance.
    expect(Object.keys(r.candidates[0]).sort()).toEqual(["category", "id", "name", "name_en"]);
  });

  it("distinguishes identically named candidates by distance, nearest first", () => {
    // 全聯福利中心 says nothing on its own; a distance is what makes the
    // agent's follow-up question answerable by a human.
    const r = resolvePlaceOne("全聯福利中心", FIXTURE_FEATURES, VIEW.center);
    if (r.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(r.candidates.map((c) => c.id)).toEqual(["osm:node:30", "osm:node:32"]);
    const near = r.candidates[0].distance_m ?? -1;
    const far = r.candidates[1].distance_m ?? -1;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
  });

  it("reports 'none' rather than an arbitrary nearest name", () => {
    expect(resolvePlaceOne("Shibuya", FIXTURE_FEATURES)).toEqual({ kind: "none" });
  });
});
