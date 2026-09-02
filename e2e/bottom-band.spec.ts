/**
 * T-109 -- the gate `docs/TASKS.md` states for the bottom band: "nothing in
 * the bottom band covers anything else, at any width, with any number of
 * categories loaded."
 *
 * Three fix commits earn this file (`fix/ui-poi-strip-dock-overlap`):
 *  - `stop the loaded-POI strip before the Places dock` -- the strip
 *    (`LoadedCategories.tsx`, `poi-loaded`) now stops in the gutter beside the
 *    dock instead of running under it.
 *  - `the attribution stays clear of the dock` -- three browsed chips make
 *    the dock wide enough to cover the licence attribution, the WebMCP badge
 *    and the corner whisper; the bottom bar now lifts a row above the dock
 *    the moment a browsed chip lands on it (`.dock-actives`).
 *  - `review follow-ups for the dock caps` -- tier-boundary and naming fixes
 *    to the same mechanism.
 *
 * The mechanism (`usePublishedBox.ts`, `PlacesTray.tsx`): the dock publishes
 * its own border-box as `--dock-w`/`--dock-h` custom properties on
 * `document.documentElement` via a `ResizeObserver`, and every other bottom-
 * band surface's CSS reads them back (`.poi-strip`'s `max-width`, `.corner`'s
 * `max-width`, `.bottom-bar`'s lifted `bottom`). This file never re-derives
 * that arithmetic -- it only measures the DOM's own boxes and asserts they do
 * not intersect, which is the one thing a CSS change could get wrong that a
 * unit test of the arithmetic could not see.
 *
 * ## Reaching "many categories loaded, none painted" without an agent
 *
 * `find_features` is a real WebMCP tool call, and *every* real call wakes the
 * page (`lib/awaken`; see `chrome-toggle.spec.ts`'s own note on this) --
 * calling it to load categories would contaminate every "human chrome" cell
 * of the matrix below with an agent that was never supposed to be there.
 * Loading is reached by hand instead, the way a person really would: tapping
 * a category chip in the Places tray loads its file and paints it
 * (`browse-store.ts`), and a fourth tap evicts the oldest *painted* one
 * without ever unloading it (`multi-category browse: eviction`,
 * `multi-browse.spec.ts`) -- so tapping fifteen chips in a row loads all
 * fifteen while painting only the last three, and removing those three with
 * their own `x` (`places-clear`, which only un-paints, never unloads) leaves
 * exactly "fifteen loaded, zero painted, zero tool calls" -- the strip's own
 * worst case, reached the same way a human reaches it.
 *
 * ## Settling
 *
 * `--dock-w`/`--dock-h` are written by a `ResizeObserver` callback, not
 * synchronously with the DOM change that resizes the dock -- `waitForDock
 * Published` polls both back against the dock's own measured box (rounded up
 * the same way `usePublishedBox.ts` rounds) instead of sleeping. It is a
 * *bounded* poll, deliberately: this file is also run once against the
 * pre-fix build (which never publishes either property at all) to confirm the
 * regression, and a wait for a signal that build will never send must not
 * hang the whole matrix -- it degrades to "whatever the DOM actually settled
 * to" instead, which is exactly what the overlap assertions need to fail
 * honestly on that build.
 *
 * ## What is deliberately out of scope
 *
 * No phone-tier (390px) case: F-14 is a known, separate overflow there. No
 * width below 921px: that is the sheet-inspector tier (`@media
 * (max-width:920px)`), a different layout question from the lane-inspector
 * one this file is about. The matrix is 3 widths x 2 chromes x 3 content
 * states = 18 cases, chosen to span the fix's own documented worst points
 * (921 is where the corner's licence line starts wrapping in agent chrome;
 * 1024 and 1440 are representative mid/wide lane-tier widths) without
 * re-running every width the manual verification in the fix commits covered.
 */
import type { Locator, Page } from "@playwright/test";
import { TIER2_CATEGORIES } from "@/lib/store/tier2";
import { callTool } from "./mcp";
import { expect, test } from "./fixtures";
import { waitForAwake, waitForFeatures, waitForTools } from "./helpers";

const WIDTHS = [921, 1024, 1440] as const;
const CHROMES = ["human", "agent"] as const;
const CONTENT_STATES = ["none", "browsed3", "loaded15"] as const;

/** Three real tier-2 categories, the same ones `multi-browse.spec.ts` picks. */
const BROWSE_PICKS = ["cafe", "bar", "bakery"] as const;

/** 15 of the 18 tier-2 categories -- enough to stress the strip's width the
 * same way the fix commits' own manual verification did ("fifteen loaded
 * categories"), leaving 3 unloaded (irrelevant: nothing here asserts on the
 * total roster). */
const STRIP_CATEGORIES = TIER2_CATEGORIES.slice(0, 15);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  // 0px of overlap is allowed (touching edges): strict inequalities only.
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a box");
  return box;
}

function chip(page: Page, category: string): Locator {
  return page.locator(`[data-testid="place-chip"][data-category="${category}"]`);
}

/** Taps a category chip and waits for its own fetch to land, the same
 * `pick` idiom `multi-browse.spec.ts` uses. */
async function pickCategory(page: Page, category: string): Promise<void> {
  await chip(page, category).click();
  await expect(chip(page, category)).not.toHaveAttribute("data-loading", "true");
}

/** Un-paints whatever is currently on the dock's `places-active` row, one `x`
 * per chip -- `remove()` (browse-store.ts) only un-paints; it never unloads,
 * so this is how "loaded, not painted" is reached for categories that were
 * necessarily painted for a moment while they were the newest of three. */
async function clearAllPainted(page: Page): Promise<void> {
  const active = page.getByTestId("places-active");
  if ((await active.count()) === 0) return;
  const attr = (await active.getAttribute("data-categories")) ?? "";
  for (const category of attr.split(",").filter(Boolean)) {
    await page.locator(`[data-testid="places-clear"][data-category="${category}"]`).click();
  }
  await expect(page.getByTestId("places-active")).toHaveCount(0);
}

/**
 * Polls until `--dock-w`/`--dock-h` (published by `usePublishedBox.ts`'s
 * `ResizeObserver`) agree with the dock's own measured, rounded-up box --
 * bounded, and swallowed on timeout (see the file header: a pre-fix build
 * never publishes either property, and that is not itself the regression
 * this file exists to catch).
 */
async function waitForDockPublished(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const dock = document.querySelector<HTMLElement>('[data-testid="places-dock"]');
        if (!dock) return false;
        const rect = dock.getBoundingClientRect();
        const width = `${Math.ceil(rect.width)}px`;
        const height = `${Math.ceil(rect.height)}px`;
        const styles = getComputedStyle(document.documentElement);
        return (
          styles.getPropertyValue("--dock-w").trim() === width &&
          styles.getPropertyValue("--dock-h").trim() === height
        );
      },
      // No argument to pass into the page function -- `undefined` here is
      // load-bearing: `waitForFunction`'s second positional parameter is the
      // page-function argument, not the options bag, and passing `{timeout}`
      // there instead of as the third parameter silently falls back to the
      // ambient TEST timeout (30s/60s) instead of the 3s meant to bound this
      // wait -- exactly the gap that let a pre-fix build's never-resolving
      // predicate eat the whole test budget instead of degrading quickly.
      undefined,
      { timeout: 3000 },
    );
  } catch {
    // See the file header's "Settling" section.
  }
}

/** Every `.attribution a` link: on screen, and not covered by anything --
 * `document.elementFromPoint` at its own centre must land on the link
 * itself or a descendant of it. */
async function assertAttributionLinksClickable(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("page has no viewport size");
  const links = page.locator(".attribution a");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const result = await links.nth(i).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        clickable: hit === el || el.contains(hit),
        text: el.textContent,
      };
    });
    expect(result.clickable, `attribution link "${result.text}" covered: ${JSON.stringify(result.rect)}`).toBe(
      true,
    );
    expect(result.rect.x, `"${result.text}" left of viewport`).toBeGreaterThanOrEqual(0);
    expect(result.rect.y, `"${result.text}" above viewport`).toBeGreaterThanOrEqual(0);
    expect(result.rect.x + result.rect.width, `"${result.text}" right of viewport`).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(result.rect.y + result.rect.height, `"${result.text}" below viewport`).toBeLessThanOrEqual(
      viewport.height,
    );
  }
}

test.describe("T-109 -- nothing in the bottom band covers anything else", () => {
  for (const width of WIDTHS) {
    for (const chrome of CHROMES) {
      for (const content of CONTENT_STATES) {
        test(`${width}x900, ${chrome} chrome, ${content}`, async ({ page }) => {
          if (content === "loaded15") test.setTimeout(60_000);

          await page.setViewportSize({ width, height: 900 });
          await page.goto("/");
          await waitForTools(page);
          await waitForFeatures(page);

          if (chrome === "agent") {
            const state = await callTool(page, "get_map_state");
            expect(state.error).toBeUndefined();
            expect(await waitForAwake(page, 2500)).toBe("awake");
          }

          let expectedActive = 0;
          let expectedStrip = 0;

          if (content === "browsed3") {
            await page.getByTestId("places-toggle").click();
            for (const category of BROWSE_PICKS) await pickCategory(page, category);
            await page.getByTestId("places-toggle").click();
            expectedActive = 3;
            expectedStrip = 0;
          } else if (content === "loaded15") {
            await page.getByTestId("places-toggle").click();
            for (const category of STRIP_CATEGORIES) await pickCategory(page, category);
            await clearAllPainted(page);
            await page.getByTestId("places-toggle").click();
            expectedActive = 0;
            expectedStrip = 15;
          }

          // The setup really reached the state this cell claims to test --
          // without this, a broken `pick`/`clearAllPainted` would leave every
          // assertion below vacuously true against the "none" layout instead
          // of failing where the setup actually broke.
          await expect(page.getByTestId("places-active-item")).toHaveCount(expectedActive);
          await expect(page.getByTestId("poi-loaded-item")).toHaveCount(expectedStrip);

          await waitForDockPublished(page);

          const dockBox = await boxOf(page.getByTestId("places-dock"));
          const attributionBox = await boxOf(page.getByTestId("attribution"));
          const badgeBox = await boxOf(page.getByTestId("webmcp-status"));

          expect(
            overlaps(dockBox, attributionBox),
            `dock ${JSON.stringify(dockBox)} overlaps attribution ${JSON.stringify(attributionBox)}`,
          ).toBe(false);
          expect(
            overlaps(dockBox, badgeBox),
            `dock ${JSON.stringify(dockBox)} overlaps webmcp-status ${JSON.stringify(badgeBox)}`,
          ).toBe(false);

          if (expectedStrip > 0) {
            const stripBox = await boxOf(page.getByTestId("poi-loaded"));
            expect(
              overlaps(dockBox, stripBox),
              `dock ${JSON.stringify(dockBox)} overlaps poi-loaded ${JSON.stringify(stripBox)}`,
            ).toBe(false);
          }

          await assertAttributionLinksClickable(page);
        });
      }
    }
  }
});
