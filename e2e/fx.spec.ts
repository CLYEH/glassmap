/**
 * T-72 -- e2e for the agent-presence FX layer (T-71, `src/components/fx/`).
 *
 * The unit suite (`driver.test.ts`, `plan.test.ts`, `geometry.test.ts`,
 * `easing.test.ts`) already proves the driver's four laws against fake
 * effects with no DOM. What this file adds is the part those tests cannot
 * see: a real page, real tool calls through `document.modelContext` (the
 * "honest path" -- this suite drives effects exactly the way a WebMCP client
 * would, never through the dev-only `window.__glassmapFx` handle), and the
 * two shipped surfaces' own `data-fx-*` attributes.
 *
 * Network-isolated by default like the rest of this suite (fixtures.ts):
 * viewport-space effects (`get_map_state`'s viewfinder, `list_features_in_view`'s
 * scan band) never need a live map at all. Map-space effects (`set_map_view`'s
 * reticle, `annotate`/`human_note`'s pin ripple) need MapLibre's camera
 * transform, which is set at construction time and does not depend on the
 * basemap style or tiles ever loading (see `data-and-view.spec.ts`'s own
 * comment on this) -- `waitForLiveMap` is enough, no `E2E_LIVE_BASEMAP`
 * needed, and no assertion in this file depends on anything actually being
 * drawn on the WebGL canvas itself.
 */
import type { Page } from "@playwright/test";
import { decodeShareState } from "@/lib/map-tools/share";
import { callTool } from "./mcp";
import { waitForFeatures, waitForLiveMap, waitForTools } from "./helpers";
import { expect, test } from "./fixtures";

const CENTER = { lng: 121.5175, lat: 25.0478 };

/**
 * Samples `fx-viewport`'s `data-fx-*` dataset once per animation frame for
 * `ms`, entirely inside the page. A Node-side `expect.poll` only samples at
 * its own cadence (~100ms) and would happily miss an effect that appeared
 * and cleaned up between two polls; this instead asks the browser's own
 * frame clock, so a regression that shows FX for even a single frame during
 * the sampled window cannot hide from it.
 */
async function sampleFx(page: Page, ms: number): Promise<{ maxCount: number; namesSeen: string[] }> {
  return page.evaluate((duration) => {
    return new Promise<{ maxCount: number; namesSeen: string[] }>((resolve) => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
      const start = performance.now();
      let maxCount = 0;
      const namesSeen = new Set<string>();
      const tick = (now: number) => {
        const count = Number(viewport?.dataset.fxCount ?? "0");
        if (count > maxCount) maxCount = count;
        const playing = viewport?.dataset.fxPlaying ?? "";
        if (playing) for (const name of playing.split(",")) namesSeen.add(name);
        if (now - start < duration) requestAnimationFrame(tick);
        else resolve({ maxCount, namesSeen: [...namesSeen] });
      };
      requestAnimationFrame(tick);
    });
  }, ms);
}

/**
 * Records every distinct `data-fx-count` / `data-fx-playing` value `viewport`
 * takes on over `ms`, via a `MutationObserver` rather than a Node-side poll.
 * `announce()` (FxLayer.tsx) writes both attributes together in one
 * synchronous step whenever the live set changes, so the observer's callback
 * fires exactly once per real transition -- a two-effect overlap that lasts
 * only a couple of frames (two similarly-timed durations, e.g. viewfinder's
 * 1100ms vs reticle's 1300ms) is a value Playwright's own ~100ms+ poll
 * cadence could plausibly step over entirely; the browser's own mutation
 * queue cannot.
 */
async function recordFxTransitions(
  page: Page,
  ms: number,
): Promise<{ count: string; playing: string }[]> {
  return page.evaluate((duration) => {
    return new Promise<{ count: string; playing: string }[]>((resolve) => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
      const transitions: { count: string; playing: string }[] = [];
      const record = () =>
        transitions.push({
          count: viewport?.dataset.fxCount ?? "0",
          playing: viewport?.dataset.fxPlaying ?? "",
        });
      record();
      const observer = new MutationObserver(record);
      if (viewport) {
        observer.observe(viewport, {
          attributes: true,
          attributeFilter: ["data-fx-count", "data-fx-playing"],
        });
      }
      setTimeout(() => {
        observer.disconnect();
        resolve(transitions);
      }, duration);
    });
  }, ms);
}

test.describe("FX layer (T-72)", () => {
  test("ON path: a read tool plays, then clears within the 2.5s window with zero residue", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    const viewport = page.getByTestId("fx-viewport");
    const overlay = page.getByTestId("fx-overlay");

    // Live while it runs: exactly one name, since only one call was made.
    await expect(viewport).toHaveAttribute("data-fx-playing", "get_map_state");
    await expect(viewport).toHaveAttribute("data-fx-count", "1");

    // The ≤2s law plus real margin: `get_map_state`'s own effect (viewfinder)
    // declares 1100ms, well inside the 2.5s ceiling this asserts.
    await expect(viewport).toHaveAttribute("data-fx-count", "0", { timeout: 2500 });
    await expect(viewport).toHaveAttribute("data-fx-playing", "");

    // Zero residue: the driver's cleanup runs in the same synchronous step
    // that flips the count to "0" (driver.ts's `finish` then `announce`), so
    // by the time the attribute reads "0" the DOM is already clean.
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
    expect(await overlay.evaluate((el) => el.childElementCount)).toBe(0);
  });

  test("concurrency honesty: different target keys coexist instead of preempting each other", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    // get_map_state keys on "viewport", set_map_view keys on "camera"
    // (plan.ts) -- disjoint keys, so the second must NOT fast-fade the
    // first the way two calls about the SAME place would (plan.ts's own
    // "describe + compare about the same place replace each other" rule).
    // This is the review's finding-1 regression this spec exists to guard.
    //
    // Recording starts before either call fires and keeps every transition
    // for a full 2.5s -- long enough to see both effects arrive, one of them
    // (whichever finishes first) leave, and the surface clear, without
    // betting on Playwright's own poll cadence catching a possibly-brief
    // "exactly one left" window (viewfinder's 1100ms and reticle's 1300ms
    // are close enough together that a coarse poll can step right over it).
    const [transitions] = await Promise.all([
      recordFxTransitions(page, 2500),
      (async () => {
        const first = await callTool(page, "get_map_state");
        expect(first.error).toBeUndefined();
        const second = await callTool(page, "set_map_view", { center: CENTER, zoom: 14 });
        expect(second.error).toBeUndefined();
      })(),
    ]);

    // Both were live together at some point, under both their real names.
    const bothLive = transitions.find((t) => t.count === "2");
    expect(bothLive, `expected a count=2 transition, saw: ${JSON.stringify(transitions)}`).toBeTruthy();
    const namesAtBothLive = bothLive!.playing.split(",").sort();
    expect(namesAtBothLive).toEqual(["get_map_state", "set_map_view"]);

    // Strictly after that, exactly one remained -- the survivor must be one
    // of the two original names, not a partial preemption of both.
    const bothLiveIndex = transitions.indexOf(bothLive!);
    const oneLeft = transitions
      .slice(bothLiveIndex + 1)
      .find((t) => t.count === "1");
    expect(oneLeft, `expected a count=1 transition after the count=2 one, saw: ${JSON.stringify(transitions)}`).toBeTruthy();
    expect(namesAtBothLive).toContain(oneLeft!.playing);

    // And, still within the recorded window, both eventually cleared: zero
    // residue even for two concurrent effects.
    expect(transitions.some((t) => t.count === "0" && t.playing === "")).toBe(true);
  });

  test("kill switch: ?fx=off never gains a single child across 3 calls", async ({ page }) => {
    await page.goto("/?fx=off");
    await waitForTools(page);
    // MapCanvas is a next/dynamic import that can still be pending well after
    // window.__glassmap appears (helpers.ts documents it); the tool calls below
    // exercise MapLibre-backed reads, so without this wait the map is sometimes
    // still "loading" and list_features_in_view answers "map not ready" -
    // an intermittent failure diagnosed independently by two reviews.
    await waitForLiveMap(page);

    await expect(page.locator("body")).toHaveAttribute("data-fx", "off");

    const [sampled] = await Promise.all([
      sampleFx(page, 1200),
      (async () => {
        const a = await callTool(page, "get_map_state");
        expect(a.error).toBeUndefined();
        const b = await callTool(page, "list_features_in_view");
        expect(b.error).toBeUndefined();
        const c = await callTool(page, "get_share_link");
        expect(c.error).toBeUndefined();
      })(),
    ]);

    // driver.ts's killed branch never calls `announce()` at all -- the
    // dataset must sit exactly where FxLayer initialised it, for the whole
    // sampled window, not just at the two endpoints a plain before/after
    // check would look at.
    expect(sampled.maxCount).toBe(0);
    expect(sampled.namesSeen).toEqual([]);

    const viewport = page.getByTestId("fx-viewport");
    const overlay = page.getByTestId("fx-overlay");
    await expect(viewport).toHaveAttribute("data-fx-count", "0");
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
    expect(await overlay.evaluate((el) => el.childElementCount)).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });

  test("mount-replay guard: history that landed before this layer mounted never replays", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // Five distinct calls, two of which (draw_shape, annotate) leave an
    // artifact the address bar carries -- so the reload below has real
    // "history" to (not) replay, not an empty store.
    const view = await callTool(page, "set_map_view", { center: CENTER, zoom: 14 });
    expect(view.error).toBeUndefined();
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
    const selected = await callTool(page, "select_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });
    expect(selected.error).toBeUndefined();
    const annotated = await callTool(page, "annotate", { at: CENTER, note: "quiet corner" });
    expect(annotated.error).toBeUndefined();

    // Wait for the debounced hash write (SHARE_WRITE_DEBOUNCE_MS) to
    // converge on everything these 5 calls produced -- the same
    // decode-to-convergence idiom share-link.spec.ts uses -- so the reload
    // below genuinely carries state, rather than racing the write.
    await expect
      .poll(async () => {
        const hash = await page.evaluate(() => location.hash);
        if (!/^#v\d+\./.test(hash)) return "no versioned hash yet";
        const decoded = decodeShareState(hash);
        if ("error" in decoded) return `undecodable: ${decoded.error}`;
        return `d${decoded.drawings.length} a${decoded.annotations.length}`;
      })
      .toBe("d1 a1");

    await page.reload();
    await waitForTools(page);

    // Same-origin full reload resets every module (no backend, no
    // localStorage for `activity`); the hash restores the drawing and note
    // through `store.addDrawing`/`addAnnotation` (share-hash.ts), which never
    // calls `recordActivity`. Sample the whole first 1.2s of the fresh mount
    // WHILE independently confirming the restore actually happened, so a
    // pass here cannot mean "there was nothing to replay in the first place".
    const [sampled] = await Promise.all([
      sampleFx(page, 1200),
      expect(page.getByTestId("drawing-count")).toHaveText("1"),
      expect(page.getByTestId("annotation-count")).toHaveText("1"),
    ]);

    expect(sampled.maxCount).toBe(0);
    expect(sampled.namesSeen).toEqual([]);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
    await expect(page.getByTestId("fx-viewport")).toHaveAttribute("data-fx-count", "0");
  });

  test("reduced motion (?rm=1): visible lifetime stays far under the 2s law", async ({ page }) => {
    await page.goto("/?rm=1");
    await waitForTools(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    const viewport = page.getByTestId("fx-viewport");
    // RM_MS is 220ms (driver.ts) -- generous poll headroom here, but still
    // well under half of get_map_state's own full-motion 1100ms and a small
    // fraction of the 2s law: if `?rm=1` silently stopped switching in the
    // reduced-motion variant, this would time out rather than pass by luck.
    await expect(viewport).toHaveAttribute("data-fx-count", "0", { timeout: 800 });
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
  });

  test("human-gesture separation: a human note gets its own effect but never a feed row", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    await expect(page.getByTestId("activity-call")).toHaveCount(0);

    // No SubmitEvent.agentInvoked patch: an ordinary visitor's browser.
    await page.getByTestId("add-note-input").fill("a human note for FX");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");

    // planForHuman's "note" branch -> pinEffect("human_note", ROSE_DEEP):
    // rose, not teal, and drawn from the human gesture channel, not the feed.
    await expect(
      page.locator('[data-testid="fx-effect"][data-fx-name="human_note"]'),
    ).toHaveCount(1);

    // A person's own gesture is not agent activity: the feed must not grow
    // (plan.ts: "there is no activity entry to key to, so seq is null and no
    // row glows").
    await expect(page.getByTestId("activity-call")).toHaveCount(0);
  });
});
