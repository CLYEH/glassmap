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
 * Blocks the basemap style and tiles so MapLibre's `load` event can never
 * fire -- `map-status` stays "loading" (or "error") for the life of the
 * test, so `map-status !== "ready"` is a permanent, not merely
 * fast-enough-to-observe, condition. Must be called before `page.goto`.
 * WebGL itself is untouched, so `window.__glassmapMap` still becomes
 * available and constructor-time bounds still get set.
 */
export async function blockBasemapNetwork(page: Page): Promise<void> {
  await page.route(/openfreemap\.org/, (route) => route.abort());
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
