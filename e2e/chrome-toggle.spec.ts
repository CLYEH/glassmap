/**
 * T-93 -- the manual chrome toggle (`components/panel-store.ts`), the part of
 * its contract `awakening.spec.ts` does not cover: what closing or opening the
 * agent chrome by hand does to the visible corridor, to the count a
 * hand-closed chrome carries, and to the landing hint's honesty. The timing-
 * sensitive half of the contract (the choreography, the awaken log, the
 * inert-during-waking toggle) lives in `awakening.spec.ts`'s own "manual
 * chrome toggle" describe block, next to the machine it composes with and the
 * helpers that read its clock.
 */
import type { Page } from "@playwright/test";
import { callTool } from "./mcp";
import { expect, test } from "./fixtures";
import { waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

/** Taipei Main Station -- the same point `DEFAULT_VIEW` centres on. */
const CENTER = { lng: 121.5175, lat: 25.0478 };

/** Poll until the map has rendered at least one real viewport. */
async function waitForBounds(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="bounds"]')?.textContent !== "none",
  );
}

/** Opens the agent chrome through the same two clicks a visitor would make. */
async function openChromeByHand(page: Page): Promise<void> {
  await page.getByTestId("agent-spark").click();
  await page.getByTestId("chrome-open").click();
}

/**
 * Reads `bounds`/`view.center` straight off the dev store handle
 * (`window.__glassmapStore`, the same one `awakening.spec.ts`'s "a human note
 * or hand-drawn shape" test uses) instead of through `callTool`.
 *
 * This is the one thing that makes a "chrome opened/closed BY HAND, with no
 * agent involved" corridor test possible at all: `get_map_state` is a real
 * WebMCP call, and per this app's own product rule (`lib/awaken`) ANY real
 * call wakes the page on its own -- reading the "idle, nobody has acted"
 * baseline through the tool layer would spend the Awakening as a side effect
 * of taking a measurement, contaminating the very state this file exists to
 * probe. The store read has no such effect: it is a plain snapshot, the same
 * one `StateOverlay` renders, with none of the tool layer's instrumentation.
 */
async function readCorridor(page: Page): Promise<{ bounds: [number, number, number, number] | null; center: [number, number] }> {
  return page.evaluate(() => {
    const state = window.__glassmapStore!.getState();
    return { bounds: state.bounds, center: state.view.center };
  });
}

function span(bounds: [number, number, number, number]): number {
  const [west, , east] = bounds;
  return east - west;
}

test.describe("the corridor under a manual toggle (T-93 / companion to redesign-corridor-bounds.spec.ts)", () => {
  /**
   * `redesign-corridor-bounds.spec.ts`'s own "hiding the inspector
   * (sidebar-toggle) does not move the reported bounds" spec must stay green
   * forever: Hide only empties the panel's body, the glass sheet keeps
   * covering the same lane either way, and the corridor beside it is
   * therefore unchanged. The agent-view toggle here is the opposite control on
   * purpose -- closing (or opening) it removes (or adds) the sheet itself, so
   * the corridor, and everything `get_map_state().bounds` says about it, MUST
   * move, in exact step with `--lane` (`MapCanvas.tsx`'s `inspectorLane`). A
   * design that left the two indistinguishable in words was the whole reason
   * this file's own docs/design contract exists (B2 -- tool-output integrity).
   */
  test("hand-opening the chrome at full desktop shrinks bounds by exactly the lane's own share of the container, and closing restores it exactly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await waitForBounds(page);
    await waitForStoreHandle(page);

    const containerWidth = await page.locator(".map-wrap").evaluate((el) => el.clientWidth);
    const lane = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lane")),
    );
    // Sanity on the fixture itself: if a future breakpoint change moves either
    // number, this must fail loudly rather than let the ratio assertion below
    // quietly start checking a different fraction than the design promises
    // (1104/1440 at this exact width, `docs/design/t93-manual-chrome-toggle.md`).
    expect(containerWidth).toBe(1440);
    expect(lane).toBe(336);

    const idle = await readCorridor(page);
    expect(idle.bounds).not.toBeNull();
    // Still idle: reading the baseline through the store, not a tool call,
    // is what keeps this measurement honest (see `readCorridor`).
    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");
    const idleSpan = span(idle.bounds!);

    await openChromeByHand(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    // A hand-opened preview never touches the machine: still nothing but a
    // rendering fact, exactly as `awakening.spec.ts`'s own "manual chrome
    // toggle" tests pin down.
    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");

    const expectedRatio = (containerWidth - lane) / containerWidth;
    await expect
      .poll(async () => {
        const open = await readCorridor(page);
        return open.bounds ? span(open.bounds) / idleSpan : null;
      })
      .toBeCloseTo(expectedRatio, 3);

    const open = await readCorridor(page);
    // Padding is symmetric around the corridor's own centre: the lane moves
    // the EDGES, never the centre `view.center` reports.
    expect(open.center).toEqual(idle.center);
    const openMidLng = (open.bounds![0] + open.bounds![2]) / 2;
    expect(openMidLng).toBeCloseTo(open.center[0], 5);

    await page.getByTestId("chrome-close").click();
    await expect(page.getByTestId("sidebar")).toHaveCount(0);

    await expect
      .poll(async () => {
        const closed = await readCorridor(page);
        return closed.bounds ? span(closed.bounds) : null;
      })
      .toBeCloseTo(idleSpan, 5);

    const closed = await readCorridor(page);
    expect(closed.bounds![0]).toBeCloseTo(idle.bounds![0], 5); // west
    expect(closed.bounds![2]).toBeCloseTo(idle.bounds![2], 5); // east
    expect(closed.bounds![3]).toBeCloseTo(idle.bounds![3], 5); // north
    expect(closed.bounds![1]).toBeCloseTo(idle.bounds![1], 5); // south
    expect(closed.center).toEqual(idle.center);
  });

  test("at the sheet tier the toggle has no lane to take, so bounds do not move in either direction", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);
    await waitForBounds(page);
    await waitForStoreHandle(page);

    const idle = await readCorridor(page);
    expect(idle.bounds).not.toBeNull();
    const idleSpan = span(idle.bounds!);

    // The chrome still mounts as a bottom sheet (chromeVisible does not know
    // about width), but `inspectorLane()` forces 0 below 921px regardless of
    // `--lane`'s own value -- the ratio here MUST be exactly 1.0, not merely
    // close to it, or the sheet tier has quietly grown a lane the map does not
    // give up room for.
    await openChromeByHand(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();

    const open = await readCorridor(page);
    expect(open.bounds).not.toBeNull();
    expect(span(open.bounds!) / idleSpan).toBeCloseTo(1.0, 5);

    await page.getByTestId("chrome-close").click();
    await expect(page.getByTestId("sidebar")).toHaveCount(0);

    const closed = await readCorridor(page);
    expect(closed.bounds![0]).toBeCloseTo(idle.bounds![0], 5);
    expect(closed.bounds![2]).toBeCloseTo(idle.bounds![2], 5);
  });
});

test.describe("closed by hand over real work (T-93)", () => {
  test("closing by hand keeps the chrome down against the agent, the chip counts exactly, and reopening loses no history", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const first = await callTool(page, "get_map_state");
    expect(first.error).toBeUndefined();
    await expect.poll(() => page.evaluate(() => document.body.dataset.awaken)).toBe("awake");

    await page.getByTestId("chrome-close").click();
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
    await expect(page.getByTestId("activity-feed")).toHaveCount(0);
    // Nothing unseen yet: the one call so far is the one that woke the page,
    // and closing happens after it, not before.
    await expect(page.getByTestId("chrome-unseen")).toHaveCount(0);

    // Three distinct, non-consecutive-foldable calls (a write, an isolated
    // read, a write) rather than three more `get_map_state`s: activity-model's
    // own fold-on-a-run-of-3 rule (redesign-activity-feed.spec.ts) would
    // otherwise collapse them into one row and make `activity-call`'s count
    // ambiguous about exactly what this test is asserting.
    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "walk radius",
    });
    expect(drawn.error).toBeUndefined();
    const found = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });
    expect(found.error).toBeUndefined();
    const annotated = await callTool(page, "annotate", { at: CENTER, note: "quiet corner" });
    expect(annotated.error).toBeUndefined();

    // The chrome stays down against the agent: the machine is `awake`
    // underneath (four calls have now landed), but nothing except a hand
    // reopens it.
    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("awake");
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
    await expect(page.getByTestId("activity-feed")).toHaveCount(0);

    // `activitySeq` delta (panel-store.ts's `unseenCalls`), not a row count:
    // exactly the 3 calls made since close, never the 4 the agent made in
    // total, and never a "rows" number that folding could have made a lie.
    await expect(page.getByTestId("chrome-unseen")).toHaveText("3 calls");
    await expect(page.getByTestId("agent-spark")).toHaveAttribute("data-waiting", "true");

    // Reopening is the card's own control, not the spark itself: the spark
    // only toggles the card open (AgentWhisper.tsx's `onSpark`), so the way
    // back in is a second, deliberate click -- the same shape as the way in.
    await page.getByTestId("agent-spark").click();
    const reopen = page.getByTestId("chrome-open");
    await expect(reopen).toHaveText("Show the agent view");
    await reopen.click();

    await expect(page.getByTestId("sidebar")).toBeVisible();
    // Every call the agent made is still in the feed, unseen or not -- a
    // hand-closed chrome hides the count from view, it does not drop history
    // the store never stopped keeping.
    await expect(page.getByTestId("activity-call")).toHaveCount(4);
  });
});

test.describe("hint honesty over a manual close (T-93)", () => {
  test("a manual close does not bring back the landing hint over agent work", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // Sanity: the landing hint is there before anything has happened, so its
    // absence below is a real transition and not a tautology.
    await expect(page.getByTestId("map-hint")).toBeVisible();

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "walk radius",
    });
    expect(drawn.error).toBeUndefined();
    await expect.poll(() => page.evaluate(() => document.body.dataset.awaken)).toBe("awake");

    // `isAgentState` (activity.length > 0, PlacesTray.tsx) is already true, so
    // the hint is gone before the toggle is even touched -- the baseline this
    // test's own regression guard needs in order to mean anything.
    await expect(page.getByTestId("map-hint")).toHaveCount(0);

    await page.getByTestId("chrome-close").click();
    await expect(page.getByTestId("sidebar")).toHaveCount(0);

    // The hand brought the human-first surfaces back, but the hint's own gate
    // reads the MAP's state, not which chrome is on screen (PlacesTray.tsx's
    // own comment on this exact point): it must not read as a landing page
    // just because the agent chrome went away over work that is still there.
    await expect(page.getByTestId("map-hint")).toHaveCount(0);
  });
});
