import { describe, expect, it } from "vitest";
import { buildGazetteer, resolvePlace, resolvePlaceOne, stripPlaceSuffix } from "./gazetteer";
import { FIXTURE_FEATURES } from "./test-fixtures";

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

describe("resolvePlace ranking", () => {
  it("ranks exact above prefix above substring", () => {
    // "Daan" is exactly 大安站 once the station suffix is stripped; the park,
    // the park station and the district only start with it.
    const ranked = resolvePlace("Daan", FIXTURE_FEATURES);
    expect(ranked[0].id).toBe("osm:node:2");
    expect(ranked[0].score).toBe(3);
    expect(ranked.slice(1).every((m) => m.score < 3)).toBe(true);
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
    expect(ids("Sunny")).toEqual(["listing:1"]);
  });
});

describe("resolvePlaceOne", () => {
  it("prefers the exact name over the station that merely contains it", () => {
    // 大安森林公園站 also reduces to 大安森林公園 after suffix stripping, but
    // the human named the park; only the station form should return the station.
    expect(resolvePlaceOne("大安森林公園", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "osm:way:10" },
    });
    expect(resolvePlaceOne("大安森林公園站", FIXTURE_FEATURES)).toMatchObject({
      kind: "found",
      entry: { id: "osm:node:3" },
    });
  });

  it("refuses to pick between two branches of the same chain", () => {
    // A wrong guess is invisible to an agent that cannot see the map, so two
    // equally good matches must come back as a question, not an answer.
    const r = resolvePlaceOne("PX Mart", FIXTURE_FEATURES);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["osm:node:30", "osm:node:32"]);
    // Candidates carry an id to retry with and no coordinates.
    expect(Object.keys(r.candidates[0]).sort()).toEqual(["category", "id", "name", "name_en"]);
  });

  it("reports 'none' rather than an arbitrary nearest name", () => {
    expect(resolvePlaceOne("Shibuya", FIXTURE_FEATURES)).toEqual({ kind: "none" });
  });
});
