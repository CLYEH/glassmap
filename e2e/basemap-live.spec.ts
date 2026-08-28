import { waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * T-13 item 3: the one spec in this suite that is allowed to depend on the
 * real basemap CDN (`tiles.openfreemap.org`) being reachable. Every other
 * spec is deliberately independent of it (see fixtures.ts's `blockedRequests`
 * auto fixture) so CI never fails on a third-party outage the way CI run
 * 33160728189 (PR #27) did. This spec exists so a human can still confirm,
 * before a release, that the live style genuinely loads end to end --
 * something the blocked-network suite cannot see by design.
 *
 * Opt-in only: set E2E_LIVE_BASEMAP=1 to run it, e.g.
 *
 *   E2E_LIVE_BASEMAP=1 pnpm exec playwright test e2e/basemap-live.spec.ts
 *
 * `E2E_LIVE_BASEMAP=1` also disables fixtures.ts's network block for the
 * WHOLE run (not just this file) -- run this spec on its own, as above,
 * rather than mixed in with the rest of the suite. CI never sets this
 * variable (see .github/workflows/ci.yml), so this spec never runs there;
 * `test.skip` below is the enforcement, not just the doc comment.
 */
const LIVE = process.env.E2E_LIVE_BASEMAP === "1";

test.describe("basemap-live (opt-in, local pre-release only)", () => {
  test.skip(!LIVE, "set E2E_LIVE_BASEMAP=1 to run this spec against the real CDN");

  test("the real style loads and map-status reaches ready", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });
  });
});
