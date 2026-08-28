import { describe, expect, it } from "vitest";
import { loadDatasets } from "./load";
import { DATASETS } from "./schema";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 404 ? "Not Found" : "OK" });
}

function feature(category: string, id: string) {
  return {
    type: "Feature",
    properties: { id, name: "Test", category, source: "osm" },
    geometry: { type: "Point", coordinates: [121.5, 25.0] },
  };
}

/** Builds a stub fetch that answers per-file, matching DATASETS[*].file. */
function stubFetch(byFile: Record<string, Response | (() => Response)>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const entry = byFile[url];
    if (!entry) throw new Error(`unexpected fetch: ${url}`);
    return typeof entry === "function" ? entry() : entry;
  }) as typeof fetch;
}

describe("loadDatasets", () => {
  it("concatenates features from every dataset file, so tools see one combined list", async () => {
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({ features: [feature("mrt_station", "osm:node:1")] }),
      [DATASETS.park.file]: jsonResponse({ features: [feature("park", "osm:way:2")] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    const features = await loadDatasets(fetchFn);
    expect(features.map((f) => f.properties.id)).toEqual(["osm:node:1", "osm:way:2"]);
  });

  it("tolerates a missing file (404) by skipping just that category, not failing the whole load", async () => {
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({}, 404),
      [DATASETS.park.file]: jsonResponse({ features: [feature("park", "osm:way:2")] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    const features = await loadDatasets(fetchFn);
    expect(features).toHaveLength(1);
    expect(features[0].properties.id).toBe("osm:way:2");
  });

  it("throws on a duplicate id across two files, catching an authoring bug that would corrupt tool output", async () => {
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({ features: [feature("mrt_station", "dup:1")] }),
      [DATASETS.park.file]: jsonResponse({ features: [feature("park", "dup:1")] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    await expect(loadDatasets(fetchFn)).rejects.toThrow(/duplicate/i);
  });

  it("throws when a feature's category does not match the file it came from", async () => {
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({ features: [feature("park", "osm:node:1")] }),
      [DATASETS.park.file]: jsonResponse({ features: [] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    await expect(loadDatasets(fetchFn)).rejects.toThrow(/category/i);
  });

  it("throws on a category that is not in FEATURE_CATEGORIES at all (isFeatureCategory guard)", async () => {
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({ features: [feature("cafe", "osm:node:1")] }),
      [DATASETS.park.file]: jsonResponse({ features: [] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    // Matches only the isFeatureCategory branch's own message, not the
    // "expected <category>" mismatch branch - so removing this guard (the
    // code would then fall through to the mismatch check and still throw,
    // just with different wording) fails this assertion.
    await expect(loadDatasets(fetchFn)).rejects.toThrow(/invalid category/i);
  });

  it("throws when a feature has no string id (missing-id guard)", async () => {
    const featureWithoutId = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [121.5, 25.0] },
    };
    const fetchFn = stubFetch({
      [DATASETS.mrt_station.file]: jsonResponse({ features: [featureWithoutId] }),
      [DATASETS.park.file]: jsonResponse({ features: [] }),
      [DATASETS.school.file]: jsonResponse({ features: [] }),
      [DATASETS.supermarket.file]: jsonResponse({ features: [] }),
      [DATASETS.listing.file]: jsonResponse({ features: [] }),
      [DATASETS.district.file]: jsonResponse({ features: [] }),
    });

    // Matches only the id guard's own message - if it is removed, the next
    // check (isFeatureCategory on an also-missing category) throws a
    // different message, so this assertion would fail.
    await expect(loadDatasets(fetchFn)).rejects.toThrow(/missing a string id/i);
  });
});
