import { callTool } from "./mcp";
import { stableState, waitForFeatures, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";
import { COMPASS } from "@/lib/map-tools/output";

test.describe("find_features / select_features", () => {
  test("find_features: near + radius_m + categories returns sorted, capped, geometry-free results", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // "Daan Park" is the MRT station's English name (osm:node:3494960749);
    // there are 13 parks and schools within 800 m of it in the real dataset
    // (6 parks + 7 schools), well under the default limit of 20.
    const out = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });

    expect(out.error).toBeUndefined();
    expect(out.total).toBe(13);
    expect(out.returned).toBe(13);
    expect(out.features!.length).toBe(13);

    const distances: number[] = [];
    for (const feature of out.features!) {
      expect(typeof feature.id).toBe("string");
      expect(typeof feature.name).toBe("string");
      expect(["park", "school"]).toContain(feature.category);
      expect(feature.distance_m!).toBeGreaterThanOrEqual(0);
      expect(feature.distance_m!).toBeLessThanOrEqual(800);
      // describeFeature (src/lib/map-tools/output.ts) omits direction at
      // exactly zero distance -- a bearing to yourself is not meaningful --
      // so only require it once there is an actual direction to report.
      if (feature.distance_m! > 0) {
        expect(COMPASS).toContain(feature.direction);
      } else {
        expect(feature.direction).toBeUndefined();
      }
      expect(feature).not.toHaveProperty("geometry");
      expect(feature).not.toHaveProperty("coordinates");
      distances.push(feature.distance_m!);
    }
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);

    // Same filter, a tighter limit: total is unaffected, returned is capped.
    const capped = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
      limit: 5,
    });
    expect(capped.total).toBe(13);
    expect(capped.returned).toBe(5);
    expect(capped.features!.length).toBe(5);
  });

  test("select_features mirrors find_features for the same filter; a bogus id is reported, not dropped silently", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // This substring matches only some of the schools within 800 m of Daan
    // Park station (a shared character in "elementary school" / "middle
    // school" names in the dataset) -- a non-trivial filter, not
    // "everything".
    const filter = { query: "國", categories: ["school"], near: "Daan Park", radius_m: 800 };

    const found = await callTool(page, "find_features", filter);
    expect(found.total).toBeGreaterThan(0);
    // The comparison below only proves parity for the full matched set if
    // find_features did not have to truncate it: both find_features's
    // default limit and select_features's SELECTION_ID_LIMIT cap output at
    // 20, so if `total` exceeded 20 this assertion would only be comparing
    // the first 20 of each and could not catch disagreement past that.
    expect(found.total).toBeLessThanOrEqual(20);
    const foundIds = found.features!.map((f) => f.id).sort();

    const selected = await callTool(page, "select_features", filter);
    const selectedIds = selected.selected!.map((f) => f.id).sort();
    expect(selectedIds).toEqual(foundIds);
    expect(selected.state!.selection.count).toBe(foundIds.length);
    await expect(page.getByTestId("selection-count")).toHaveText(String(foundIds.length));

    // Re-select the same features by id, plus one id that was never loaded.
    const bogusId = "osm:node:not-a-real-id";
    const byIds = await callTool(page, "select_features", { ids: [...foundIds, bogusId] });
    expect(byIds.unknown_ids).toEqual([bogusId]);
    expect(byIds.unknown_count).toBe(1);
    expect(byIds.selected!.map((f) => f.id).sort()).toEqual(foundIds);
    expect(byIds.state!.selection.count).toBe(foundIds.length);
    await expect(page.getByTestId("selection-count")).toHaveText(String(foundIds.length));
  });

  test("find_features rejects an empty near object without throwing or changing state", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "get_map_state");

    const result = await callTool(page, "find_features", { near: {} });
    expect(typeof result.error).toBe("string");
    expect(result.features).toBeUndefined();

    const after = await callTool(page, "get_map_state");
    // find_features is read-only, so nothing it does can change these -- but
    // never strict-equal the whole object: bounds is written by MapCanvas's
    // own effect independently of this call (see e2e/helpers.ts stableState).
    expect(stableState(after)).toEqual(stableState(before));
  });
});
