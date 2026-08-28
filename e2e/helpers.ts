import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { BoundsResult, ToolResult } from "./types";

/** public/data/*.geojson has 2,063 renderable features as of T-10 (see docs/TASKS.md). */
export const FEATURE_COUNT = 2063;

/** True once WebMcpProvider has registered the tools (src/components/WebMcpProvider.tsx). */
export async function waitForTools(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__glassmap);
}

/** True once useFeatureData has loaded every dataset (src/components/useFeatureData.ts). */
export async function waitForFeatures(page: Page): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="feature-count"]')?.textContent === String(expected),
    FEATURE_COUNT,
  );
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
