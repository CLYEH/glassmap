import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { BoundsResult, ToolResult } from "./types";

/** public/data/*.geojson has 2,063 renderable features as of T-10 (see docs/TASKS.md). */
export const FEATURE_COUNT = 2063;

/** True once WebMcpProvider has registered the tools (src/components/WebMcpProvider.tsx). */
export async function waitForTools(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__glassmap);
}

/**
 * True once useFeatureData has loaded every dataset
 * (src/components/useFeatureData.ts). Uses `expect(...).toHaveText` (which
 * polls) rather than `waitForFunction` so a failure prints the actual vs.
 * expected count instead of a bare timeout.
 */
export async function waitForFeatures(page: Page): Promise<void> {
  await expect(page.getByTestId("feature-count")).toHaveText(String(FEATURE_COUNT));
}

/**
 * True once MapCanvas's effect has actually constructed a live MapLibre map
 * (src/components/MapCanvas.tsx sets `window.__glassmapMap` in dev builds
 * right after `new MapLibreMap(...)` succeeds). MapCanvas is a
 * `next/dynamic` import, so it can still be pending well after
 * `window.__glassmap` appears (WebMcpProvider mounts synchronously; MapCanvas
 * does not) -- tests that exercise MapLibre-specific behaviour (e.g. the
 * `flyTo` re-entrancy guard) must wait for this, not just for the tools.
 */
export async function waitForLiveMap(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__glassmapMap);
}

/**
 * True once dev-store-handle.ts has exposed the zustand store as
 * `window.__glassmapStore` (dev builds only). Needed before any test drives
 * the store directly (adding a hand-picked drawing, e.g.) instead of going
 * through a tool call.
 */
export async function waitForStoreHandle(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__glassmapStore);
}

/**
 * Deterministically reproduces MapCanvas.tsx's "map unavailable" branch
 * (headless CI without a GPU) regardless of whether this Playwright browser
 * itself has real WebGL2. Must be called before `page.goto`.
 */
export async function forceNoWebGL2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext(...args: unknown[]): unknown;
    };
    const original = proto.getContext;
    proto.getContext = function patchedGetContext(this: HTMLCanvasElement, ...args: unknown[]) {
      if (args[0] === "webgl2") return null;
      return original.apply(this, args);
    };
  });
}

/**
 * The subset of a map-state object that only changes because of a tool call.
 * `bounds` is written by MapCanvas's own effect independently of any tool
 * (once at construction time, again once the container is measured, again
 * once tiles finish loading), so two reads a few milliseconds apart can
 * legitimately disagree on it even though nothing asked the view to move.
 * Never strict-equal two reads of state including `bounds`; compare this
 * subset instead, and check `bounds` on its own with `expectBoundsShape`.
 */
export function stableState(state: ToolResult) {
  return {
    center: state.center,
    zoom: state.zoom,
    bearing: state.bearing,
    pitch: state.pitch,
    features_loaded: state.features_loaded,
    selection: state.selection,
  };
}

/**
 * Waits, on the browser's own clock, for `body[data-awaken]` to reach
 * "awake" within `timeoutMs`, and returns whatever it reads at that instant
 * (the landed value, or whatever the attribute still says once the timeout
 * elapses).
 *
 * Not a Node-side `expect.poll`: a poll round-trips to the browser on its own
 * schedule, and every one of those round trips is real Node<->browser IPC
 * time spent *inside* the budget being measured -- on a busy machine (many
 * Playwright workers, many Chromium processes) that overhead was measured to
 * exceed a second under `--repeat-each` across the full suite, enough to fail
 * a 2500ms-budgeted check even though the transition itself landed inside its
 * own 2s law (`AWAKEN_MAX_MS`, `src/lib/awaken/index.ts`). Timing the wait
 * entirely inside the page removes that overhead from the measurement.
 *
 * Ported from `awakening.spec.ts`'s own private helper (T-93's fix pattern for
 * this exact race) rather than imported from it, so this module stays free of
 * a dependency on that spec file; `remove-from-map.spec.ts` and
 * `plan-route.spec.ts` share this copy instead of re-duplicating a third
 * (T-99 -- the same 2500ms Node-side poll of `data-awaken` had lost this race
 * under parallel load in both files).
 */
export async function waitForAwake(
  page: Page,
  timeoutMs: number,
): Promise<string | undefined> {
  return page.evaluate((timeoutMs) => {
    return new Promise<string | undefined>((resolve) => {
      if (document.body.dataset.awaken === "awake") {
        resolve("awake");
        return;
      }
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(document.body.dataset.awaken);
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        if (document.body.dataset.awaken === "awake") {
          clearTimeout(timer);
          observer.disconnect();
          resolve("awake");
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-awaken"] });
    });
  }, timeoutMs);
}

/** `bounds` is either not-yet-available (`null`) or a fully-formed box; never partial. */
export function expectBoundsShape(bounds: BoundsResult | null | undefined): void {
  if (bounds == null) return;
  expect(bounds).toMatchObject({
    west: expect.any(Number),
    south: expect.any(Number),
    east: expect.any(Number),
    north: expect.any(Number),
  });
}
