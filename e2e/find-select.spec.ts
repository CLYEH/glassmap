import { callTool } from "./mcp";
import { stableState, waitForFeatures, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

test.describe("find_features / select_features", () => {
  test("find_features: near + radius_m + categories returns sorted, capped, geometry-free results", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // "Daan Park" is the MRT station's English name (osm:node:3494960749);
    // there are parks and schools within 800 m of it in the real dataset.
    const out = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });

    expect(out.error).toBeUndefined();
    expect(out.total).toBeGreaterThan(0);
    expect(out.returned).toBe(Math.min(out.total!, 20));
    expect(out.features!.length).toBe(out.returned);

    const distances: number[] = [];
    for (const feature of out.features!) {
      expect(typeof feature.id).toBe("string");
      expect(typeof feature.name).toBe("string");
      expect(["park", "school"]).toContain(feature.category);
      expect(typeof feature.distance_m).toBe("number");
      expect(feature.distance_m!).toBeLessThanOrEqual(800);
      expect(typeof feature.direction).toBe("string");
      expect(feature).not.toHaveProperty("geometry");
      expect(feature).not.toHaveProperty("coordinates");
      distances.push(feature.distance_m!);
    }
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);

    expect(pageErrors).toEqual([]);
  });

  test("select_features mirrors find_features for the same filter; a bogus id is reported, not dropped silently", async ({
    page,
    pageErrors,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // 國 ("guo", as in elementary/middle school) narrows the schools within
    // 800 m of Daan Park station to a proper subset -- a non-trivial filter,
    // not "everything".
    const filter = { query: "國", categories: ["school"], near: "Daan Park", radius_m: 800 };

    const found = await callTool(page, "find_features", filter);
    expect(found.total).toBeGreaterThan(0);
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

    expect(pageErrors).toEqual([]);
  });

  test("find_features rejects an empty near object without throwing or changing state", async ({
    page,
    pageErrors,
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

    expect(pageErrors).toEqual([]);
  });
});
