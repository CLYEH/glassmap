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

/** What `armFxClock` accumulates and `waitForFxCycle` reads back. */
interface FxClockState {
  startedAt?: number;
  startedPlaying?: string;
  clearedAt?: number;
  viewportChildren?: number;
  overlayChildren?: number;
}

/** What `waitForFxCycle` resolves with once a cycle completes (or times out). */
interface FxCycle {
  lifetimeMs: number | null;
  startedPlaying: string | null;
  viewportChildren: number | null;
  overlayChildren: number | null;
}

/**
 * Arms a persistent `MutationObserver` on `fx-viewport`'s `data-fx-count`,
 * from before the tool call that starts the effect, recording -- entirely on
 * the browser's own `performance.now()` -- the instant the first effect
 * begins ("0" -> non-"0"), the `data-fx-playing` value at that same instant,
 * and the instant the surface next fully clears (-> "0") together with
 * `fx-viewport`'s and `fx-overlay`'s `childElementCount` read inside that
 * same synchronous callback.
 *
 * Everything the test needs to confirm -- that the effect started under the
 * right name, and how long it stayed -- is captured here in one browser-side
 * observer rather than as two separate Node-side `expect()` polls: on a busy
 * machine, two sequential IPC round trips ("did it start with the right
 * name", then "has it cleared") can straddle an effect that is honestly only
 * ~1100ms long, each one arriving late enough that the *other* half of the
 * check already looks wrong (observed locally under `--repeat-each` even
 * without CI's extra load) -- a false failure of the harness, not the
 * product. Pairs with `waitForFxCycle`, which reads the result back;
 * splitting arm/read (rather than one `evaluate` spanning the tool call)
 * mirrors `awakening.spec.ts`'s `armWakingClock` / `stateAfterWaking` split
 * for the same reason: the observer has to exist in the page *before*
 * `callTool` fires, and `callTool` itself is a Node-side call this helper
 * cannot wrap.
 */
async function armFxClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __fxClock?: FxClockState };
    w.__fxClock = {};
    const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
    const overlay = document.querySelector<HTMLElement>('[data-testid="fx-overlay"]');
    if (!viewport) return;
    new MutationObserver(() => {
      const clock = w.__fxClock!;
      const count = viewport.dataset.fxCount ?? "0";
      if (count !== "0" && clock.startedAt === undefined) {
        clock.startedAt = performance.now();
        clock.startedPlaying = viewport.dataset.fxPlaying ?? "";
      } else if (count === "0" && clock.startedAt !== undefined && clock.clearedAt === undefined) {
        clock.clearedAt = performance.now();
        clock.viewportChildren = viewport.childElementCount;
        clock.overlayChildren = overlay?.childElementCount ?? -1;
      }
    }).observe(viewport, { attributes: true, attributeFilter: ["data-fx-count"] });
  });
}

/**
 * Waits, on the browser's own clock, for `armFxClock`'s observer to see a
 * full start -> clear cycle, then returns the browser-measured lifetime, the
 * name it started under, and the child counts recorded at the clearing
 * instant. Not a Node-side `expect.poll`, for the same reason
 * `awakening.spec.ts`'s `waitForAwake` exists: a poll's own Node<->browser
 * round trips are real time spent *inside* the budget being measured, and on
 * a busy CI runner (many Playwright workers, many Chromium processes, this
 * call's own tool concurrently playing T-83's 1.8s awakening choreography on
 * the main thread) that overhead was measured to be enough to fail a check
 * the effect's own browser-clock lifetime passed comfortably. `null` fields
 * mean the cycle never completed inside `timeoutMs`, on the browser's own
 * clock -- a genuine finding, not a measurement artifact.
 */
async function waitForFxCycle(page: Page, timeoutMs: number): Promise<FxCycle> {
  return page.evaluate((timeoutMs) => {
    return new Promise<FxCycle>((resolve) => {
      const w = window as unknown as { __fxClock?: FxClockState };
      const deadline = performance.now() + timeoutMs;
      const check = () => {
        const clock = w.__fxClock;
        if (clock?.startedAt !== undefined && clock.clearedAt !== undefined) {
          resolve({
            lifetimeMs: clock.clearedAt - clock.startedAt,
            startedPlaying: clock.startedPlaying ?? null,
            viewportChildren: clock.viewportChildren ?? null,
            overlayChildren: clock.overlayChildren ?? null,
          });
        } else if (performance.now() >= deadline) {
          resolve({ lifetimeMs: null, startedPlaying: null, viewportChildren: null, overlayChildren: null });
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, timeoutMs);
}

test.describe("FX layer (T-72)", () => {
  test("ON path: a read tool plays, then clears within the 2.5s window with zero residue", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);

    const viewport = page.getByTestId("fx-viewport");

    // Armed before the call, on the browser's own clock (T-85's
    // `waitForAwake` pattern) -- not a pair of Node-side `expect()` polls,
    // whose own IPC round trips would be spent *inside* the budget this test
    // measures, and which can straddle an honestly ~1100ms effect entirely
    // (each round trip arriving late enough that the OTHER half of the check
    // already looks wrong -- observed locally under `--repeat-each`, not
    // only on CI). This first live call also plays T-83's 1.8s awakening
    // choreography concurrently (a separate surface, `body[data-awaken]`,
    // that this test never reads): on a slow shared CI runner that
    // main-thread work can starve this effect's own rAF callbacks too, which
    // is exactly why a Node-side poll measured this as a real failure (T-85
    // finding 3) even though the effect's own browser-clock lifetime stayed
    // inside the law. Timing entirely inside the page removes the IPC
    // overhead from the measurement; genuine main-thread contention still
    // shows up, honestly, inside the budget below.
    await armFxClock(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    const cycle = await waitForFxCycle(page, 2500);

    // It actually started, under the one name this single call should
    // produce -- not "there was nothing to time" passing by luck -- captured
    // at the same browser-clock instant the lifetime below is measured from.
    expect(cycle.lifetimeMs, `fx cycle never cleared within 2.5s: ${JSON.stringify(cycle)}`).not.toBeNull();
    expect(cycle.startedPlaying).toBe("get_map_state");

    // The ≤2s law plus real margin: `get_map_state`'s own effect (viewfinder)
    // declares 1100ms, well inside the 2.5s ceiling this asserts -- measured
    // on the browser's own clock, so neither the awakening's concurrent main-
    // thread work nor Node's IPC latency is counted against this budget.
    expect(cycle.lifetimeMs).toBeLessThanOrEqual(2500);

    // Zero residue, read inside the exact same synchronous MutationObserver
    // tick that saw the count reach "0" (driver.ts's `finish` then
    // `announce` run together, so the DOM is already clean the instant the
    // attribute says so) -- no separate round trip in which anything else
    // (the awakening's own chrome mounting, a later effect) could land a
    // false-positive child in between.
    expect(cycle.viewportChildren).toBe(0);
    expect(cycle.overlayChildren).toBe(0);

    // Final-state consistency check, not a timing budget: by now the surface
    // has already settled (the browser-clock cycle above proved it), so a
    // plain Node-side assertion cannot race anything here.
    await expect(viewport).toHaveAttribute("data-fx-count", "0");
    await expect(viewport).toHaveAttribute("data-fx-playing", "");
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
    //
    // The two `callTool` calls are dispatched together (`Promise.all`, not a
    // sequential `await` of the first before the second is sent) rather than
    // one at a time: this is the first live call on a fresh page, so it also
    // plays T-83's 1.8s awakening choreography on the main thread, and a
    // sequential dispatch bets that `get_map_state`'s FULL Node<->browser
    // round trip -- getTools(), executeTool(), JSON parse, serialise the
    // reply back -- finishes inside its own ~1100ms effect. Under that main-
    // thread contention it does not always: reproduced locally, `set_map_view`
    // was not even sent until after `get_map_state`'s effect had fully
    // cleared, so the two effects never overlapped and this test's own
    // premise (assert on an overlap) failed honestly on a harness race, not a
    // product one. Both assertions stay order-agnostic below (`namesAtBothLive`
    // is sorted, `oneLeft` accepts either survivor) precisely because the
    // "disjoint keys coexist" law this test guards never depended on which
    // call landed first.
    const [transitions, [first, second]] = await Promise.all([
      recordFxTransitions(page, 2500),
      Promise.all([
        callTool(page, "get_map_state"),
        callTool(page, "set_map_view", { center: CENTER, zoom: 14 }),
      ]),
    ]);
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();

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

    // `?rm=1` only forces FX's own reduced-motion switch (`FxLayer.tsx`'s
    // `forceReducedMotion`); it does nothing to the awakening choreography,
    // which reads `prefers-reduced-motion` instead (`choreography.ts:265`)
    // and is not emulated in this suite. So this first live call still plays
    // T-83's full 1.8s story on the main thread, same as the ON-path test
    // above -- the browser-clock pattern is the same fix for the same
    // reason: a Node-side poll's own IPC round trips would be spent inside
    // the tight budget this test uses on purpose to discriminate the RM
    // variant from full motion.
    await armFxClock(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    // RM_MS is 220ms (driver.ts). 800ms is generous headroom against
    // browser-side jitter but still well under half of get_map_state's own
    // full-motion 1100ms and a small fraction of the 2s law: if `?rm=1`
    // silently stopped switching in the reduced-motion variant, this would
    // time out rather than pass by luck.
    const cycle = await waitForFxCycle(page, 800);
    expect(cycle.lifetimeMs, `RM cycle never cleared within 800ms: ${JSON.stringify(cycle)}`).not.toBeNull();
    expect(cycle.startedPlaying).toBe("get_map_state");
    expect(cycle.lifetimeMs).toBeLessThanOrEqual(800);
    expect(cycle.viewportChildren).toBe(0);
  });

  test("human-gesture separation: a human note gets its own effect but never a feed row", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    await expect(page.getByTestId("activity-call")).toHaveCount(0);

    // No SubmitEvent.agentInvoked patch: an ordinary visitor's browser.
    // T-82 chrome flip: the note form now lives in a closed popover
    // (opacity:0, pointer-events:none) until note-toggle opens it.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
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
