import { callTool } from "./mcp";
import { waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * Tier-2 POI dots + halos (T-62/T-64), opt-in, real-CDN-only.
 *
 * `gm-poi-circle` and the selection halo layers are only ever added inside
 * MapLibre's `load` event (MapCanvas.tsx), which needs the real basemap style
 * to finish loading -- not merely `style.load` (the flag `applyView` checks
 * to pick `flyTo` vs `jumpTo`), the full `load`. Under this suite's default
 * network isolation the CDN is unreachable, so `map-status` can only ever
 * reach "loading" or "error" (see data-and-view.spec.ts), `load` never fires,
 * and there is no `gm-poi-circle` layer to query at all -- canvas assertions
 * about painted dots belong here, not in tier2.spec.ts / tier2-share.spec.ts,
 * whose DOM/tool assertions are isolation-safe by design.
 *
 * Opt-in only, same convention as basemap-live.spec.ts:
 *
 *   E2E_LIVE_BASEMAP=1 pnpm exec playwright test e2e/tier2-live.spec.ts
 *
 * CI never sets this variable, so this spec never runs there; `test.skip`
 * below is the enforcement, not just the doc comment.
 */
const LIVE = process.env.E2E_LIVE_BASEMAP === "1";

test.describe("tier-2 POI rendering (opt-in, local pre-release only)", () => {
  test.skip(!LIVE, "set E2E_LIVE_BASEMAP=1 to run this spec against the real CDN");

  test("selecting a loaded POI category paints a dot per feature; deselecting clears them", async ({
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

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__glassmapMap!.queryRenderedFeatures({ layers: ["gm-poi-circle"] }).length,
        ),
      )
      .toBe(ids.length);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__glassmapMap!.queryRenderedFeatures({ layers: ["gm-selection-halo"] }).length,
        ),
      )
      .toBe(ids.length);

    const cleared = await callTool(page, "select_features", { ids: [] });
    expect(cleared.error).toBeUndefined();

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__glassmapMap!.queryRenderedFeatures({ layers: ["gm-poi-circle"] }).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__glassmapMap!.queryRenderedFeatures({ layers: ["gm-selection-halo"] }).length,
        ),
      )
      .toBe(0);
  });
});
