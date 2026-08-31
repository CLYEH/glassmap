import type { Page } from "@playwright/test";
import { BEAD_CLUSTER_LAYER, BEAD_LAYER, BROWSE_BEAD_LAYER, BROWSE_GRAIN_LAYER } from "@/components/bead-style";
import { browseTierMinimum, countedClusterThreshold } from "@/components/bead-style";
import { SELECTION_RING_LAYER } from "@/components/map-style";
import { callTool } from "./mcp";
import { waitForAwake, waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * Tier-2 POI beads (T-62/T-64/T-81), opt-in, real-CDN-only.
 *
 * `gm-bead` / `gm-bead-cluster` and the rest of the bead layers are only ever
 * added inside MapLibre's `load` event (MapCanvas.tsx), which needs the real
 * basemap style to finish loading -- not merely `style.load` (the flag
 * `applyView` checks to pick `flyTo` vs `jumpTo`), the full `load`. Under this
 * suite's default network isolation the CDN is unreachable, so `map-status`
 * can only ever reach "loading" or "error" (see data-and-view.spec.ts),
 * `load` never fires, and there is no bead layer to query at all -- canvas
 * assertions about painted marks belong here, not in tier2.spec.ts /
 * tier2-share.spec.ts, whose DOM/tool assertions are isolation-safe by
 * design.
 *
 * T-81 replaced the old flat `gm-poi-circle` dot with the bead/cluster system
 * (coalescing at ~30 screen px) and split the selection halo in two: a
 * selected point of interest is a bead (`gm-bead` / `gm-bead-cluster`,
 * `bead-style.ts`), while `gm-selection-ring` now draws only for selected
 * **bundled** features (park/school/…), which have a category colour to ring
 * and no bead of their own (`map-style.ts`'s own comment on the split). A POI
 * selection must therefore never paint a ring.
 *
 * Opt-in only, same convention as basemap-live.spec.ts:
 *
 *   E2E_LIVE_BASEMAP=1 pnpm exec playwright test e2e/tier2-live.spec.ts
 *
 * CI never sets this variable, so this spec never runs there; `test.skip`
 * below is the enforcement, not just the doc comment.
 */
const LIVE = process.env.E2E_LIVE_BASEMAP === "1";

/**
 * The true count of a bead/cluster layer pair: every unclustered mark, plus
 * the `point_count` of every cluster in view. Clusters are addressed by
 * `cluster_id` because one straddling a tile seam is returned twice by
 * `queryRenderedFeatures` -- the same dedupe MapCanvas.tsx's own ink-budget
 * pass uses.
 */
async function coalescedTotal(page: Page, layers: readonly [string, string]): Promise<number> {
  return page.evaluate((layers) => {
    const map = window.__glassmapMap!;
    const clusters = new Map<number, number>();
    let singles = 0;
    for (const feature of map.queryRenderedFeatures({ layers: [...layers] })) {
      const { cluster_id: cluster, point_count: count } = feature.properties as {
        cluster_id?: number;
        point_count?: number;
      };
      if (typeof cluster === "number" && typeof count === "number") clusters.set(cluster, count);
      else singles += 1;
    }
    let total = singles;
    for (const count of clusters.values()) total += count;
    return total;
  }, layers);
}

test.describe("tier-2 POI rendering (opt-in, local pre-release only)", () => {
  test.skip(!LIVE, "set E2E_LIVE_BASEMAP=1 to run this spec against the real CDN");

  test("selecting a loaded POI category paints beads whose coalesced count matches the selection; the selection ring stays empty; deselecting clears the beads", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });

    const cafes = await callTool(page, "find_features", { categories: ["cafe"], limit: 5 });
    expect(cafes.error).toBeUndefined();
    const ids = cafes.features!.map((f) => f.id);

    const selected = await callTool(page, "select_features", { ids });
    expect(selected.error).toBeUndefined();

    // The coalesced total (beads + cluster point_counts), not a flat
    // `gm-poi-circle` count: two selected cafes within ~30 screen px now
    // coalesce into one counted cluster bead (T-81), so a per-feature dot
    // count would be the wrong law to hold this system to.
    await expect
      .poll(() => coalescedTotal(page, [BEAD_LAYER, BEAD_CLUSTER_LAYER]))
      .toBe(ids.length);

    // A POI selection never rings -- it beads instead (map-style.ts's own
    // comment on the halo split); the ring layer is for bundled features.
    expect(
      await page.evaluate(
        (layer) => window.__glassmapMap!.queryRenderedFeatures({ layers: [layer] }).length,
        SELECTION_RING_LAYER,
      ),
    ).toBe(0);

    const cleared = await callTool(page, "select_features", { ids: [] });
    expect(cleared.error).toBeUndefined();

    await expect
      .poll(() => coalescedTotal(page, [BEAD_LAYER, BEAD_CLUSTER_LAYER]))
      .toBe(0);
  });

  test("clicking an unclustered browsed bead selects it and opens its card; Remove takes it off the map again", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));
    await expect
      .poll(() => page.getByTestId("browse-state").textContent())
      .toMatch(/^cafe places=\d+/);

    // A real rendered, UNCLUSTERED browse mark and its current screen
    // position -- real OSM data, so this can legitimately come back empty at
    // some camera positions if every nearby cafe has already coalesced.
    const target = await page.evaluate(
      ([grain, bead]) => {
        const map = window.__glassmapMap!;
        const feature = map
          .queryRenderedFeatures({ layers: [grain, bead] })
          .find((f) => typeof (f.properties as { cluster_id?: number }).cluster_id !== "number");
        if (!feature || feature.geometry.type !== "Point") return null;
        const id = (feature.properties as { id?: string }).id ?? null;
        const point = map.project(feature.geometry.coordinates as [number, number]);
        return { id, x: point.x, y: point.y };
      },
      [BROWSE_GRAIN_LAYER, BROWSE_BEAD_LAYER],
    );
    test.skip(target === null, "no unclustered browse mark in the default view to click");
    if (!target) return;

    await page.mouse.click(target.x, target.y);

    await expect(page.getByTestId("on-the-map-card")).toBeVisible();
    await expect(page.getByTestId("selection-count")).toHaveText("1");

    // A bead answers to the same tap door every other mark does: it opens
    // the card rather than toggling itself off (MapCanvas.tsx's `tapFeature`
    // -- Remove is the card's own writer, the same one the tools use).
    await page.getByTestId("otm-remove").click();
    await expect(page.getByTestId("selection-count")).toHaveText("0");
    await expect(page.getByTestId("on-the-map-card")).toHaveCount(0);
  });

  test("the browse ink budget is corridor-scoped: it agrees with a threshold computed from only the corridor, not the whole canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });

    // Agent chrome, so the inspector lane exists and narrows the corridor the
    // budget is computed over (MapCanvas.tsx's `inspectorLane()`).
    const call = await callTool(page, "get_map_state");
    expect(call.error).toBeUndefined();
    expect(await waitForAwake(page, 2500)).toBe("awake");

    await page.evaluate(() => window.__glassmapBrowse!.getState().browse("cafe"));
    await expect
      .poll(() => page.getByTestId("browse-state").textContent())
      .not.toContain("loading");

    // Opening the inspector does not itself resize the map container, so
    // nothing re-triggers the budget pass without a real camera move -- one
    // registered inside the same evaluate call as the pan, so there is no
    // round trip in which "idle" could fire before the listener is armed.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__glassmapMap!;
          map.once("idle", () => resolve());
          map.panBy([1, 0]);
        }),
    );

    // The corridor MapCanvas.tsx's own `applyInkBudget` uses, computed here
    // independently (same formula: container width minus `--lane`, full
    // height) and queried directly -- not read back from the store, so a
    // regression that widened the query to the whole canvas would make this
    // independent count (and therefore the threshold derived from it)
    // disagree with what `browse-state` reports.
    //
    // Both sides are recomputed together on every retry, not once against a
    // static expectation: a second `idle` can still land shortly after the
    // one this test waited for (a deferred reflow, a webfont metrics swap),
    // and only re-deriving "expected" and "actual" close together, repeatedly,
    // survives that without racing it.
    await expect
      .poll(async () => {
        const { corridorCounts, zoom, browseState } = await page.evaluate(
          ([grain, bead]) => {
            const map = window.__glassmapMap!;
            const container = map.getContainer();
            const lane =
              Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue("--lane"),
              ) || 0;
            const corridor: [[number, number], [number, number]] = [
              [0, 0],
              [Math.max(container.clientWidth - lane, 0), container.clientHeight],
            ];
            const counts = new Map<number, number>();
            for (const feature of map.queryRenderedFeatures(corridor, { layers: [grain, bead] })) {
              const { cluster_id: cluster, point_count: count } = feature.properties as {
                cluster_id?: number;
                point_count?: number;
              };
              if (typeof cluster === "number" && typeof count === "number") counts.set(cluster, count);
            }
            const el = document.querySelector('[data-testid="browse-state"]');
            return {
              corridorCounts: [...counts.values()],
              zoom: map.getZoom(),
              browseState: el?.textContent ?? "",
            };
          },
          [BROWSE_GRAIN_LAYER, BROWSE_BEAD_LAYER],
        );

        const expectedThreshold = countedClusterThreshold(
          corridorCounts,
          undefined,
          browseTierMinimum(zoom),
        );
        const expectedText = Number.isFinite(expectedThreshold)
          ? `counted>=${expectedThreshold}`
          : "counted>=none";

        return browseState.includes(expectedText) ? "match" : `expected ${expectedText}, got "${browseState}"`;
      })
      .toBe("match");
  });
});
