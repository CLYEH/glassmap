import { waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * T-13 item 4: proves fixtures.ts's `blockedRequests` auto fixture is not
 * vacuously green -- i.e. that the app genuinely attempts to reach
 * `tiles.openfreemap.org` (so a page that stopped requesting it, e.g. a
 * style hosted same-origin, would make this test fail rather than pass for
 * the wrong reason) and that the abort actually intercepts it, rather than
 * the request completing anyway because a pattern silently stopped matching.
 * `blockedRequests` itself already asserts (in its own teardown) that
 * nothing bypassed the block; this spec is the positive half of that.
 */
test.describe("network isolation (T-13)", () => {
  test("the basemap CDN request is attempted and blocked, never reaching the network", async ({
    page,
    blockedRequests,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    await expect
      .poll(() => blockedRequests, {
        message: "the app should have attempted -- and been blocked from completing -- a request to the basemap CDN",
      })
      .toEqual(expect.arrayContaining([expect.stringContaining("tiles.openfreemap.org")]));
  });
});
