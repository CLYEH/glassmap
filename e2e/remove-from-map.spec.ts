/**
 * T-90 -- `remove_from_map`: the agent's half of the gesture the page already
 * gives a human on OnTheMapCard -- tap a mark, see who made it, press Remove.
 *
 * `src/lib/map-tools/remove.test.ts` already proves the dispatch, every
 * bucket and the provenance asymmetry against an in-memory store with no DOM.
 * What this file adds is the part that suite cannot see: a real page, tool
 * calls through `document.modelContext` the way a WebMCP client makes them,
 * and the two surfaces a person actually watches -- the map's own counts
 * (`StateOverlay`, chrome-independent) and the activity feed's own row text
 * -- agreeing with what the JSON says. Adversarial cases (a hand-drawn shape,
 * a near-miss id, an empty batch) get their own tests rather than being
 * folded into a happy path, because each one is a way this tool could
 * quietly do harm instead of refusing cleanly.
 *
 * Fixtures for "content a human made" are written straight onto
 * `window.__glassmapStore` (`addDrawing({source: "user", ...})`), the
 * established entry point this suite uses for human-authored marks with no
 * scripted mouse path across a real map -- see
 * `redesign-share-provenance.spec.ts` and `share-link.spec.ts`. That choice
 * also sidesteps the one caveat the handoff flagged for this file (N4):
 * `AddNoteForm` stamps an annotation's `source` from `SubmitEvent.agentInvoked`,
 * which only matters to a spec that drives the form. Nothing here does.
 */
import type { Page } from "@playwright/test";
import { decodeShareState } from "@/lib/map-tools/share";
import { callTool } from "./mcp";
import { expect, test } from "./fixtures";
import { waitForAwake, waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

const CENTER = { lng: 121.5175, lat: 25.0478 };

// --------------------------------------------------------------- fx clock
// Reimplements fx.spec.ts's own browser-clock MutationObserver idiom (a
// private helper there, not exported, so duplicated rather than imported):
// a Node-side poll of `data-fx-*` has its own IPC round trip inside the
// ~700ms dissolve this file measures, which is exactly the race fx.spec.ts's
// own comments record having produced a false failure before. Extended with
// `nodeSeenAtStart`, which that file's version has no need for: this file's
// whole point is telling "played, but degraded to the geometry-less glow"
// apart from "played, and really drew a dissolve", not just "played".
interface FxClockState {
  startedAt?: number;
  startedPlaying?: string;
  nodeSeenAtStart?: boolean;
  clearedAt?: number;
  viewportChildren?: number;
  overlayChildren?: number;
}

interface FxCycle {
  lifetimeMs: number | null;
  startedPlaying: string | null;
  nodeSeenAtStart: boolean;
  viewportChildren: number | null;
  overlayChildren: number | null;
}

/**
 * Arms a persistent observer on `fx-viewport`'s `data-fx-count`. Call before
 * the triggering tool call. Disconnects any observer a previous call armed:
 * this file calls `armFxClock` more than once per test (once per effect it
 * watches for in turn), and a stale observer left running would still fire on
 * the next mutation with `effectName` closed over its OWN, now-wrong value --
 * misreporting `nodeSeenAtStart` for whichever observer happens to run first,
 * even though it reads the same (freshly reset) clock object the current
 * observer does.
 */
async function armFxClock(page: Page, effectName: string): Promise<void> {
  await page.evaluate((effectName) => {
    const w = window as unknown as { __removeFxClock?: FxClockState; __removeFxObserver?: MutationObserver };
    w.__removeFxObserver?.disconnect();
    w.__removeFxClock = {};
    const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
    const overlay = document.querySelector<HTMLElement>('[data-testid="fx-overlay"]');
    if (!viewport) return;
    const observer = new MutationObserver(() => {
      const clock = w.__removeFxClock!;
      const count = viewport.dataset.fxCount ?? "0";
      if (count !== "0" && clock.startedAt === undefined) {
        clock.startedAt = performance.now();
        clock.startedPlaying = viewport.dataset.fxPlaying ?? "";
        clock.nodeSeenAtStart =
          document.querySelectorAll(`[data-testid="fx-effect"][data-fx-name="${effectName}"]`).length > 0;
      } else if (count === "0" && clock.startedAt !== undefined && clock.clearedAt === undefined) {
        clock.clearedAt = performance.now();
        clock.viewportChildren = viewport.childElementCount;
        clock.overlayChildren = overlay?.childElementCount ?? -1;
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ["data-fx-count"] });
    w.__removeFxObserver = observer;
  }, effectName);
}

/** Waits, on the browser's own clock, for `armFxClock`'s observer to see a full start -> clear cycle. */
async function waitForFxCycle(page: Page, timeoutMs: number): Promise<FxCycle> {
  return page.evaluate((timeoutMs) => {
    return new Promise<FxCycle>((resolve) => {
      const w = window as unknown as { __removeFxClock?: FxClockState };
      const deadline = performance.now() + timeoutMs;
      const check = () => {
        const clock = w.__removeFxClock;
        if (clock?.startedAt !== undefined && clock.clearedAt !== undefined) {
          resolve({
            lifetimeMs: clock.clearedAt - clock.startedAt,
            startedPlaying: clock.startedPlaying ?? null,
            nodeSeenAtStart: clock.nodeSeenAtStart ?? false,
            viewportChildren: clock.viewportChildren ?? null,
            overlayChildren: clock.overlayChildren ?? null,
          });
        } else if (performance.now() >= deadline) {
          resolve({
            lifetimeMs: null,
            startedPlaying: null,
            nodeSeenAtStart: false,
            viewportChildren: null,
            overlayChildren: null,
          });
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, timeoutMs);
}

/**
 * A hand-drawn shape, the way a human's mouse would leave one: written
 * straight onto the store. Returns the id the store assigned.
 */
async function addHumanDrawing(page: Page, label: string): Promise<string> {
  const drawing = await page.evaluate(
    ({ center, label }) =>
      window.__glassmapStore!.getState().addDrawing({
        source: "user",
        kind: "polygon",
        label,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [center.lng - 0.01, center.lat - 0.01],
              [center.lng + 0.01, center.lat - 0.01],
              [center.lng, center.lat + 0.01],
              [center.lng - 0.01, center.lat - 0.01],
            ],
          ],
        },
      }),
    { center: CENTER, label },
  );
  expect(drawing.source).toBe("user");
  return drawing.id;
}

test.describe("remove_from_map (T-90)", () => {
  test("round trip: draw_shape then remove_from_map takes the agent's own circle back off the map", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 400,
      label: "10-min walk",
    });
    expect(drawn.error).toBeUndefined();
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    const out = await callTool(page, "remove_from_map", { ids: [drawn.drawing_id as string] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([
      { id: drawn.drawing_id, kind: "drawing", source: "agent", label: "10-min walk" },
    ]);
    expect(out.removed_count).toBe(1);

    // The map and the store agree it is gone, not just the tool's own echo of
    // what it just did.
    await expect(page.getByTestId("drawing-count")).toHaveText("0");
    expect(await page.evaluate(() => window.__glassmapStore!.getState().drawings)).toEqual([]);

    const state = await callTool(page, "get_map_state");
    expect(state.drawings).toEqual({ count: 0, items: [] });
  });

  test("deselect: removing one selected id leaves the other selected -- on the map, in state, and its provenance intact", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    // Two real, loaded features -- the same filter find-select.spec.ts uses,
    // so this does not depend on network or on a guessed id ever existing.
    const found = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });
    expect(found.error).toBeUndefined();
    const [idA, idB] = found.features!.map((f) => f.id);
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();

    // idA stands in for a human's own click (MapCanvas.tsx's `tapFeature`
    // attributes "user"); idB for something the agent selected. Written
    // straight onto the store for the same reason `addHumanDrawing` is:
    // there is no scripted mouse path across a real map in this suite.
    // Removing idB is a real test of "only the named id leaves" (S5) only
    // because the two ids disagree on who chose them.
    await page.evaluate(
      ({ idA, idB }) =>
        window.__glassmapStore!.getState().setSelection([idA, idB], { [idA]: "user", [idB]: "agent" }),
      { idA, idB },
    );
    await expect(page.getByTestId("selection-count")).toHaveText("2");

    const out = await callTool(page, "remove_from_map", { ids: [idB] });
    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([{ id: idB, kind: "selection", source: "agent" }]);

    await expect(page.getByTestId("selection-count")).toHaveText("1");
    const state = await callTool(page, "get_map_state");
    expect(state.selection).toEqual({ count: 1, ids: [idA] });

    const sources = await page.evaluate(() => window.__glassmapStore!.getState().selectionSources);
    expect(sources).toEqual({ [idA]: "user" });

    // Attribution survives the wire too: a share link built right after this
    // still calls idA the human's pick, not an agent's or nobody's -- the
    // fact `select_features`' own pruning filter would have destroyed had
    // this tool reused it (S5).
    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    const decoded = decodeShareState(`#${share.url!.split("#")[1]}`);
    if ("error" in decoded) throw new Error(`share link failed to decode: ${decoded.error}`);
    expect(decoded.selection).toEqual([idA]);
    expect(decoded.userSelected).toEqual([idA]);
  });

  test("refusal: a hand-drawn shape is refused, stays on the map, and its row reads as success -- not 'Refused —'", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    const humanDrawingId = await addHumanDrawing(page, "picnic spot (human)");
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    const out = await callTool(page, "remove_from_map", { ids: [humanDrawingId] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([
      {
        id: humanDrawingId,
        kind: "drawing",
        source: "user",
      },
    ]);
    expect(out.refused_reason).toContain("tap it on the map and press Remove");
    expect(out.refused_count).toBe(1);

    // Still there: the tool's word for it, and the map's.
    await expect(page.getByTestId("drawing-count")).toHaveText("1");
    const ids = await page.evaluate(() => window.__glassmapStore!.getState().drawings.map((d) => d.id));
    expect(ids).toEqual([humanDrawingId]);

    // The feed row this call made must read as a success, not a top-level
    // refusal (B4): a per-id refusal is not a batch error, and "Refused — …"
    // would tell a reader watching the feed that nothing happened here --
    // hiding, in a bigger batch, the removals that really did succeed.
    expect(await waitForAwake(page, 2500)).toBe("awake");
    const row = page.locator('[data-testid="activity-call"][data-tool="remove_from_map"]').last();
    await expect(row).toBeVisible();
    const text = await row.innerText();
    expect(text).not.toContain("Refused —");
    expect(text).toContain("of yours kept");
  });

  test("buckets: a good drawing id, a near-miss mark id and an unknown feature id can be removed together, and the batch still succeeds", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "loop",
    });
    expect(drawn.error).toBeUndefined();
    const goodId = drawn.drawing_id as string;
    const unknownId = "osm:node:not-a-real-e2e-id";

    // "Drawing:1" is a near miss of the very id this call also names: wrong
    // case, not a typo of nothing. A caller who wrote it must be told it
    // looks like a mark id, not sent looking for a feature that never existed.
    const out = await callTool(page, "remove_from_map", { ids: [goodId, "Drawing:1", unknownId] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([{ id: goodId, kind: "drawing", source: "agent", label: "loop" }]);
    expect(out.malformed_ids).toEqual(["Drawing:1"]);
    expect(out.malformed_error).toContain("drawing:");
    expect(out.malformed_count).toBe(1);
    expect(out.unknown_ids).toEqual([unknownId]);
    expect(out.unknown_count).toBe(1);

    await expect(page.getByTestId("drawing-count")).toHaveText("0");
  });

  test("ids: [] is refused -- that verb belongs to select_features({ids: []})", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const drawn = await callTool(page, "draw_shape", { type: "circle", center: CENTER, radius_m: 300 });
    expect(drawn.error).toBeUndefined();

    const out = await callTool(page, "remove_from_map", { ids: [] });
    expect(out.error).toContain("select_features({ids: []})");
    expect(out.state).toBeDefined();
    expect(out.removed).toBeUndefined();

    // A validation error changes nothing: the shape drawn a moment ago is
    // exactly where it was.
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    // Contrast with the refusal test above: a top-level error DOES read as
    // "Refused —", because unlike a per-id refusal nothing in this batch
    // succeeded, so there is no successful removal the wording could hide.
    expect(await waitForAwake(page, 2500)).toBe("awake");
    const row = page.locator('[data-testid="activity-call"][data-tool="remove_from_map"]').last();
    await expect(row).toContainText("Refused —");
  });
});

test.describe("remove_from_map FX (T-90)", () => {
  test("removing an agent's drawing plays a dissolve that clears within 2s, with zero residue", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    // Let draw_shape's own effect (ink, 1500ms) fully play and clear before
    // arming the next window: otherwise its trailing mutation could be
    // mistaken for the removal's own start.
    await armFxClock(page, "draw_shape");
    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "loop",
    });
    expect(drawn.error).toBeUndefined();
    const drawCycle = await waitForFxCycle(page, 2500);
    expect(drawCycle.startedPlaying, JSON.stringify(drawCycle)).toBe("draw_shape");

    await armFxClock(page, "remove_from_map");
    const removed = await callTool(page, "remove_from_map", { ids: [drawn.drawing_id as string] });
    expect(removed.error).toBeUndefined();
    const cycle = await waitForFxCycle(page, 2500);

    expect(cycle.startedPlaying, JSON.stringify(cycle)).toBe("remove_from_map");
    // The real dissolve, not the geometry-less glow-only fallback: the ghost
    // the removal left behind was placeable, so `data-testid="fx-effect"`
    // really drew something for this call, not just lit the feed row.
    expect(cycle.nodeSeenAtStart).toBe(true);
    expect(cycle.lifetimeMs, JSON.stringify(cycle)).not.toBeNull();
    expect(cycle.lifetimeMs).toBeLessThanOrEqual(2000);
    expect(cycle.viewportChildren).toBe(0);
    expect(cycle.overlayChildren).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });

  test("a wholly refused call still glows the feed row, but never spawns a dissolve node", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    const humanDrawingId = await addHumanDrawing(page, "picnic spot (fx)");

    await armFxClock(page, "remove_from_map");
    const out = await callTool(page, "remove_from_map", { ids: [humanDrawingId] });
    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([]);

    const cycle = await waitForFxCycle(page, 2000);
    // It still plays -- the feed row still glows on the call's own clock --
    // but degrades to the geometry-less fallback (plan.ts: no ids removed ->
    // {kind: "none"}), because there is nothing left on the map to dissolve.
    expect(cycle.startedPlaying, JSON.stringify(cycle)).toBe("remove_from_map");
    expect(cycle.nodeSeenAtStart).toBe(false);
    expect(cycle.viewportChildren).toBe(0);
    expect(cycle.overlayChildren).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });

  test("?fx=off: draw then remove never spawns a single fx-effect node", async ({ page }) => {
    await page.goto("/?fx=off");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);

    await expect(page.locator("body")).toHaveAttribute("data-fx", "off");

    const drawn = await callTool(page, "draw_shape", { type: "circle", center: CENTER, radius_m: 300 });
    expect(drawn.error).toBeUndefined();
    const out = await callTool(page, "remove_from_map", { ids: [drawn.drawing_id as string] });
    expect(out.error).toBeUndefined();

    // driver.ts's killed branch never calls `announce()` at all -- both
    // datasets sit exactly where FxLayer initialised them.
    const viewport = page.getByTestId("fx-viewport");
    const overlay = page.getByTestId("fx-overlay");
    await expect(viewport).toHaveAttribute("data-fx-count", "0");
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
    expect(await overlay.evaluate((el) => el.childElementCount)).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });
});
