/**
 * T-85 -- the Awakening's own ordering (`src/lib/awaken/`, `components/awaken/`),
 * end to end. The unit suite (`awaken.test.ts`, `timeline.test.ts`) already
 * proves the eleven store-level orderings and the beat math against a fake
 * store with no DOM; this file is the part those tests cannot see: a real
 * page, real tool calls through `document.modelContext`, and the two document
 * attributes (`html[data-chrome]`, `body[data-awaken]`) plus the DOM surfaces
 * a person actually watches.
 *
 * Every wait here is on `body[data-awaken]`, never on a testid's mere
 * presence: the agent panels (feed, ticker, lane) mount on "waking" -- the
 * first frame of the 1.8s story -- precisely so there is something for the
 * choreography to move (`src/lib/awaken/index.ts`'s own contract: "the e2e
 * suite waits on 'awake', not on a frame"). A testid existing is evidence the
 * story has *started*, never that it has landed.
 *
 * Network-isolated by default like the rest of this suite (fixtures.ts): none
 * of what is asserted here needs the real basemap style or tiles.
 */
import { decodeShareState } from "@/lib/map-tools/share";
import { AWAKEN_MS } from "@/lib/awaken";
import { callTool } from "./mcp";
import { blockExternalNetwork, expect, test } from "./fixtures";
import { waitForFeatures, waitForStoreHandle, waitForTools } from "./helpers";

/** Taipei Main Station -- the same point `DEFAULT_VIEW` centres on. */
const CENTER = { lng: 121.5175, lat: 25.0478 };

/**
 * Attaches an init script that records every value `body[data-awaken]` ever
 * takes on, from before any of the page's own scripts run -- the only way to
 * prove a mode was never entered for even one frame, rather than merely that
 * it is absent by the time a test gets around to reading it. Must be called
 * before `goto`/`reload`; `document.documentElement` does not exist yet the
 * instant an init script runs, so this retries across frames until it does.
 */
async function attachAwakenLog(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __awakenLog: string[] };
    w.__awakenLog = [];
    const attach = () => {
      const root = document.documentElement;
      if (!root) {
        requestAnimationFrame(attach);
        return;
      }
      new MutationObserver((records) => {
        for (const record of records) {
          const el = record.target as HTMLElement;
          if (el.dataset.awaken !== undefined) w.__awakenLog.push(el.dataset.awaken);
        }
      }).observe(root, { subtree: true, attributes: true, attributeFilter: ["data-awaken"] });
    };
    attach();
  });
}

async function awakenLog(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __awakenLog: string[] }).__awakenLog);
}

/**
 * Arms an in-page clock that records `performance.now()` the instant
 * `body[data-awaken]` first becomes "waking". Must be called before the tool
 * call that triggers the transition.
 */
async function armWakingClock(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __wakingAt?: number };
    new MutationObserver(() => {
      if (document.body.dataset.awaken === "waking" && w.__wakingAt === undefined) {
        w.__wakingAt = performance.now();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["data-awaken"] });
  });
}

/**
 * Waits, entirely on the browser's own clock, until at least `minMs` have
 * really elapsed since `armWakingClock` saw "waking" begin, then reads
 * `body[data-awaken]` in that same tick and returns it.
 *
 * Not `page.waitForTimeout` followed by a separate `page.evaluate` read: that
 * pair adds two Node<->browser round trips of slack between "enough time has
 * passed" and "read the state now" -- on a busy machine (many Playwright
 * workers, many Chromium processes) that slack was measured to exceed a
 * second under `--repeat-each` across the full suite, long enough to race
 * past the natural ~1.8s landing this helper exists to stay short of.
 * Resolving the wait and the read inside one `evaluate` call removes the gap:
 * whatever real time Node takes to receive the answer, the answer itself was
 * captured at the correct moment.
 */
async function stateAfterWaking(
  page: import("@playwright/test").Page,
  minMs: number,
): Promise<string | undefined> {
  return page.evaluate((minMs) => {
    return new Promise<string | undefined>((resolve) => {
      const w = window as unknown as { __wakingAt?: number };
      const check = () => {
        if (w.__wakingAt !== undefined && performance.now() - w.__wakingAt >= minMs) {
          resolve(document.body.dataset.awaken);
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, minMs);
}

/**
 * Waits, on the browser's own clock, for `body[data-awaken]` to reach
 * "awake" within `timeoutMs`, and returns whatever it reads at that instant
 * (the landed value, or whatever the attribute still says once the timeout
 * elapses).
 *
 * Not a Node-side `expect.poll`: a poll round-trips to the browser on its
 * own schedule, and every one of those round trips is real Node<->browser
 * IPC time spent *inside* the budget being measured -- on a busy machine
 * (many Playwright workers, many Chromium processes) that overhead was
 * measured to exceed a second under `--repeat-each` across the full suite,
 * enough to fail this check even though the transition itself landed inside
 * its own 2s law (`AWAKEN_MAX_MS`, `src/lib/awaken/index.ts`). Timing the
 * wait entirely inside the page removes that overhead from the measurement:
 * the law is checked against the browser's own clock, and Node only has to
 * wait however long it separately takes to hear the answer back.
 */
async function waitForAwake(
  page: import("@playwright/test").Page,
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

test.describe("boot states (T-85)", () => {
  test("landing is idle chrome: no agent-only surfaces, the human tools are there", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).not.toBe("awake");
    await expect.poll(() => page.evaluate(() => document.body.dataset.awaken)).toBe("idle");

    await expect(page.getByTestId("activity-feed")).toHaveCount(0);
    await expect(page.getByTestId("activity-ticker")).toHaveCount(0);
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
    await expect(page.getByTestId("tools")).toBeVisible();
    await expect(page.getByTestId("places-dock")).toBeVisible();
  });

  test("a human note or hand-drawn shape in idle chrome never wakes the page", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");

    // A human draw, through the store the way a hand-drawn shape lands (no
    // scripted mouse path across a live map in this suite -- the same
    // substitute redesign-share-provenance.spec.ts uses).
    await page.evaluate(
      (center) =>
        window.__glassmapStore!.getState().addDrawing({
          source: "user",
          kind: "polygon",
          label: "human triangle",
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
      CENTER,
    );

    // A human note, through the real form -- no `agentInvoked` patch, an
    // ordinary visitor's browser.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await page.getByTestId("add-note-input").fill("a human note that must not wake the page");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");

    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");
    await expect(page.getByTestId("activity-call")).toHaveCount(0);
    await expect(page.getByTestId("activity-feed")).toHaveCount(0);
  });

  test("reload after awakening restores awake chrome directly, without replaying the story", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "walk radius",
    });
    expect(drawn.error).toBeUndefined();

    expect(await waitForAwake(page, 2500)).toBe("awake");

    // The debounced address-bar mirror has to converge before a reload can
    // carry anything -- the same idiom fx.spec.ts's mount-replay guard uses.
    await expect
      .poll(async () => {
        const hash = await page.evaluate(() => location.hash);
        if (!/^#v\d+\./.test(hash)) return "no versioned hash yet";
        const decoded = decodeShareState(hash);
        return "error" in decoded ? `undecodable: ${decoded.error}` : `d${decoded.drawings.length}`;
      })
      .toBe("d1");

    await attachAwakenLog(page);
    await page.reload();
    await waitForTools(page);
    await waitForFeatures(page);

    await expect.poll(() => page.evaluate(() => document.body.dataset.awaken)).toBe("awake");
    await expect(page.getByTestId("drawing-count")).toHaveText("1");
    // The no-replay guarantee, checked directly rather than inferred from
    // timing: this page's document never wrote "waking" even once.
    expect(await awakenLog(page)).not.toContain("waking");
  });
});

test.describe("the first live arrival (T-85)", () => {
  test("the first live tool call wakes the page within 2.5s: a feed row lands and the badge claims connection", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    // The 1.8s story runs; only the lifecycle attribute is proof it landed.
    expect(await waitForAwake(page, 2500)).toBe("awake");

    await expect(page.getByTestId("activity-call")).toHaveCount(1);
    await expect(page.getByTestId("webmcp-status")).toContainText("Agent connected");
  });
});

test.describe("restored links carry work, not an arrival (T-85)", () => {
  test("a v2 agent link opened fresh boots straight to awake with no story, and the badge stays hedged until a live call", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // Tier-2 category loaded + selected by the tool surface: v2 wire, and an
    // unattributed (no `su`) selection, which `restoredAgentStateOf` reads as
    // the agent's.
    const cafes = await callTool(page, "find_features", { categories: ["cafe"], near: CENTER, limit: 3 });
    expect(cafes.error).toBeUndefined();
    const ids = cafes.features!.map((f) => f.id);
    const selected = await callTool(page, "select_features", { ids });
    expect(selected.error).toBeUndefined();

    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    expect(share.url).toBeDefined();
    expect(share.url).toContain("#v2.");

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await attachAwakenLog(page2);
    await page2.goto(share.url!);
    await waitForTools(page2);
    // Not `waitForFeatures`: that helper asserts the bundled-only count
    // (2063), but this link also restores a tier-2 category, and
    // `feature-count` reports the combined total once it lands -- the same
    // reason tier2-share.spec.ts's own restore test never calls it either.

    await expect.poll(() => page2.evaluate(() => document.body.dataset.awaken)).toBe("awake");
    // Proof the story never ran for even one frame, not just that it is
    // absent by the time this line executes.
    expect(await awakenLog(page2)).not.toContain("waking");

    await expect(page2.getByTestId("restored-summary")).toContainText("The link carried 3 selected");
    await expect(page2.getByTestId("activity-call")).toHaveCount(0);
    // No agent is connected to a page that only opened a link -- only the
    // registration-true claim, not the stronger one.
    await expect(page2.getByTestId("webmcp-status")).toContainText("Agent-readable");

    const call = await callTool(page2, "get_map_state");
    expect(call.error).toBeUndefined();
    await expect(page2.getByTestId("webmcp-status")).toContainText("Agent connected");

    await context2.close();
    expect(errors2).toEqual([]);
  });

  test("a link whose whole selection is human-attributed (su covers it) boots idle despite carrying a selection", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    const found = await callTool(page, "find_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park"],
    });
    expect(found.error).toBeUndefined();
    const ids = found.features!.slice(0, 3).map((f) => f.id);
    expect(ids).toHaveLength(3);

    const selected = await callTool(page, "select_features", { ids });
    expect(selected.error).toBeUndefined();

    // Re-attributed to the human for every id in the selection: `su` will
    // cover the whole thing, which `restoredAgentStateOf` reads as "the one
    // selection that is evidence of no agent at all" (share.ts).
    await page.evaluate((ids) => {
      const record: Record<string, "user"> = {};
      for (const id of ids) record[id] = "user";
      window.__glassmapStore!.getState().setSelection(ids, record);
    }, ids);

    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    expect(share.url).toBeDefined();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await page2.goto(share.url!);
    await waitForTools(page2);
    await waitForFeatures(page2);

    expect(await page2.evaluate(() => document.documentElement.dataset.chrome)).toBe("idle");
    await expect.poll(() => page2.evaluate(() => document.body.dataset.awaken)).toBe("idle");
    await expect(page2.getByTestId("selection-count")).toHaveText("3");
    await expect(page2.getByTestId("activity-feed")).toHaveCount(0);
    await expect(page2.getByTestId("sidebar")).toHaveCount(0);

    await context2.close();
    expect(errors2).toEqual([]);
  });
});

test.describe("skip and pointer safety (T-85)", () => {
  test("any keydown mid-story lands the transition early and raises the toast", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await armWakingClock(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    // A third of AWAKEN_MS: comfortably mid-story, with real margin before
    // the story would land on its own.
    const state = await stateAfterWaking(page, Math.round(AWAKEN_MS / 3));
    expect(state).toBe("waking");

    await page.keyboard.press("a");

    // Landing on a keydown is synchronous (choreography.ts's `onSkip` calls
    // `land(true)` directly, no rAF wait): a working skip lands almost
    // immediately, a broken one would still be "waking" for the ~1.2s the
    // story would otherwise still have left to run -- 800ms of the browser's
    // own clock sits clearly between the two, and is immune to Node<->browser
    // IPC latency the same way `waitForAwake` is generally.
    expect(await waitForAwake(page, 800)).toBe("awake");
    await expect(page.getByTestId("awaken-caption")).toHaveAttribute("data-shown", "true");
  });

  test("a genuine click on note-toggle mid-story opens the popover instead of being swallowed", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await armWakingClock(page);

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();

    // A third of AWAKEN_MS: comfortably mid-story, with real margin left
    // before the story would land on its own.
    const state = await stateAfterWaking(page, Math.round(AWAKEN_MS / 3));
    expect(state).toBe("waking");

    // Not `locator.click()`: choreography.ts rewrites `note-toggle`'s inline
    // transform every animation frame while "waking" runs, so the element
    // never passes Playwright's own stability check (unchanged position
    // across two consecutive frames) until the story has already landed on
    // its own -- `.click()` would silently wait out the remaining ~1.2s and
    // then click an already-static button, testing nothing about mid-story
    // behaviour.
    //
    // Not `boundingBox()` + `page.mouse.click(x, y)` either: those are two
    // separate Node<->browser round trips, and the target keeps moving
    // between them -- on a busy machine the coordinate read by the first can
    // go stale before the second dispatches, landing the click on the map
    // underneath instead of the button (a false failure of exactly the kind
    // this test exists to catch, for a reason that is not the regression).
    // Reading the element's current centre and dispatching the click at it
    // happen in one `evaluate` call instead, so there is no round trip in
    // which the target can drift -- the pointerdown-skip defect's regression
    // guard: a click used to end the story mid-press and drag the chrome out
    // from under the cursor, swallowing the click entirely (choreography.ts's
    // "no-jump contract" comment; reproduced here on purpose, once by
    // accident in redesign-share-provenance.spec.ts).
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="note-toggle"]');
      if (!el) throw new Error("note-toggle not found mid-story");
      const rect = el.getBoundingClientRect();
      const opts: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, opts));
      }
    });

    // Still mid-story: only a keydown may skip it, so the click must not
    // have jumped the page to its end state as a side effect of this press.
    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("waking");
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
  });
});

test.describe("T-83 sign-off checks (design2-v5 §8.4)", () => {
  test("at 390px the map container's box changes once, at the start of waking, and stays put through landing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // `.map-wrap` has no data-testid (map-ui-dev owns Home's JSX); the class
    // is stable and is the same one named in the globals.css comment this
    // test guards ("the container MapLibre measures... every point on the
    // map translated 194px in that frame").
    const mapWrap = page.locator(".map-wrap");
    const idleBox = await mapWrap.evaluate((el) => el.getBoundingClientRect().toJSON());

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();
    await expect.poll(() => page.evaluate(() => document.body.dataset.awaken)).toBe("waking");
    const wakingBox = await mapWrap.evaluate((el) => el.getBoundingClientRect().toJSON());

    expect(await waitForAwake(page, 2500)).toBe("awake");
    const awakeBox = await mapWrap.evaluate((el) => el.getBoundingClientRect().toJSON());

    // idle -> waking really did move the container: the sheet's band is
    // already given up, under the flare, before anything else has moved.
    expect(wakingBox).not.toEqual(idleBox);
    // waking -> awake did NOT move it again -- the "largest movement in the
    // whole transition and the one nobody choreographed" this rule exists to
    // prevent.
    expect(awakeBox).toEqual(wakingBox);
  });

  test("the live region announcing the agent stays empty until the toast is actually raised", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const announce = page.getByTestId("awaken-announce");
    await expect(announce).toHaveText("");

    const result = await callTool(page, "get_map_state");
    expect(result.error).toBeUndefined();
    expect(await waitForAwake(page, 2500)).toBe("awake");

    await expect(page.getByTestId("awaken-caption")).toHaveAttribute("data-shown", "true");
    await expect(announce).toHaveText("An agent joined this map");

    // Dismissing clears it silently, so a screen reader that heard the first
    // arrival would hear a second one too. Esc is safe post-landing: the
    // skip listener already disarmed itself when the story landed
    // (choreography.ts's `land()`), so this cannot re-trigger anything.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("awaken-caption")).toHaveAttribute("data-shown", "false");
    await expect(announce).toHaveText("");
  });
});
