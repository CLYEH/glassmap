/**
 * T-106 / T-107 / T-108 -- three human-side fixes to the note a person pins
 * by hand (`note-store.ts`, `AddNoteForm.tsx`, `annotation-marker.ts`,
 * `card-model.ts`). The unit suites already prove the pure halves --
 * `note-store.test.ts` (the draft's own rounding/replace/clear rules),
 * `annotation-marker.test.ts` (`foldedLabel`) and `card-model.test.ts`
 * (the headline is the whole note). What this file adds is the part those
 * cannot see: a real click on a real MapLibre canvas, a real form submit, a
 * real pin in the DOM -- and the one thing a unit test can never prove either
 * way, the agent path staying untouched by a human's half-placed pin.
 *
 * T-106 -- a person's note used to always land at `view.center`; it now
 * lands where they clicked while the note popover was open (`note-store.ts`'s
 * `draft`), with the centre kept as the fallback for a submit with no click.
 * `add_note`'s own `agentInvoked` branch is asserted to ignore the draft
 * entirely -- the regression this suite exists to catch is an agent's note
 * silently inheriting a human's half-placed pin.
 *
 * T-107 -- folding a pin's bubble used to leave a 9px anchor whose only
 * answer was "open the card about me"; a folded pin now keeps a chip on
 * screen and a click anywhere on a folded pin unfolds it and does nothing
 * else.
 *
 * T-108 -- the "On the map" card used to clip a note at 72 characters; it now
 * shows the whole thing, however long, wrapped rather than cut.
 */
import type { Page } from "@playwright/test";
import { INTERACTIVE_LAYER_IDS } from "@/components/map-style";
import { callTool } from "./mcp";
import { expect, mockExternalHost, test } from "./fixtures";
import { waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

/** Same precision `note-store.ts`'s own `round5` rounds a clicked place to. */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

async function goReady(page: Page): Promise<void> {
  await page.goto("/");
  await waitForTools(page);
  await waitForFeatures(page);
  await waitForLiveMap(page);
  await waitForStoreHandle(page);
}

/** The map container's own box -- full-bleed and unaffected by chrome (globals.css: ".map-wrap { inset: 0 }"). */
async function mapBox(page: Page) {
  const box = await page.getByTestId("map").boundingBox();
  if (!box) throw new Error("map container has no box");
  return box;
}

/** Clicks `(dx, dy)` away from the map's own centre and returns the page-space pixel clicked. */
async function clickMapOffset(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  const box = await mapBox(page);
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.click(x, y);
  return { x, y };
}

/** What the click at `(x, y)` really unprojects to, rounded the same way the draft is -- the independent half of the "the pin is where I clicked" proof. */
async function unprojectRounded(page: Page, x: number, y: number): Promise<[number, number]> {
  return page.evaluate(
    ({ x, y }) => {
      const { lng, lat } = window.__glassmapMap!.unproject([x, y]);
      const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
      return [round5(lng), round5(lat)] as [number, number];
    },
    { x, y },
  );
}

/** `add-note-target`'s text, parsed: "centre", or the `[lng, lat]` it names. */
function parseTarget(text: string): "centre" | [number, number] {
  if (text === "centre") return "centre";
  const [lng, lat] = text.split(", ").map(Number);
  return [lng!, lat!];
}

test.describe("T-106 -- a human pins a note where they click", () => {
  test("a click while the popover is open places a draft off the map's centre; a second click moves it, not adds another", async ({
    page,
  }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");

    // 150px right of centre: away from the tools row and the popover, both
    // pinned to the top-right corner (globals.css), and far enough from
    // DEFAULT_VIEW's centre at zoom 12 (~35 m/px) that a click there cannot
    // round back to the same coordinate by accident.
    const firstClick = await clickMapOffset(page, 150, 0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);

    const firstTarget = parseTarget(await page.getByTestId("add-note-target").innerText());
    if (firstTarget === "centre") throw new Error("add-note-target still reads centre after a click");
    // The pin is drawn, the form reports and the click actually landed on the
    // same coordinate -- not merely "some coordinate that isn't the centre".
    expect(firstTarget).toEqual(await unprojectRounded(page, firstClick.x, firstClick.y));

    const state = await callTool(page, "get_map_state");
    expect(state.error).toBeUndefined();
    expect([round5(state.center!.lng), round5(state.center!.lat)]).not.toEqual(firstTarget);

    // A second click, well clear of the first and of the chrome either side.
    const secondClick = await clickMapOffset(page, -150, 90);
    // Still exactly one: the second click corrects the place, it does not add
    // a second draft (note-store.test.ts: "moves the pin ... rather than
    // collecting places").
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);
    const secondTarget = parseTarget(await page.getByTestId("add-note-target").innerText());
    if (secondTarget === "centre") throw new Error("add-note-target reverted to centre after a second click");
    expect(secondTarget).not.toEqual(firstTarget);
    expect(secondTarget).toEqual(await unprojectRounded(page, secondClick.x, secondClick.y));
  });

  test("submitting after a click pins the note at the clicked place, with zero agent activity", async ({ page }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await clickMapOffset(page, 150, 0);
    const target = parseTarget(await page.getByTestId("add-note-target").innerText());
    if (target === "centre") throw new Error("add-note-target still reads centre after a click");

    await page.getByTestId("add-note-input").fill("pinned where I tapped");
    await page.getByTestId("add-note-submit").click();

    const annotations = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.source).toBe("user");
    // Landed at the clicked place -- NOT at the map centre, which is what
    // every submit pinned to before T-106.
    expect(annotations[0]!.at).toEqual(target);

    await expect(page.locator('[data-testid="activity-call"][data-tool="add_note"]')).toHaveCount(0);
    // The place is spent with the note: the draft goes with it.
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
  });

  test("submitting with no click still pins at the map centre -- the fallback", async ({ page }) => {
    await goReady(page);
    const center = await page.evaluate(() => window.__glassmapStore!.getState().view.center);

    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
    await page.getByTestId("add-note-input").fill("no click, so the centre");
    await page.getByTestId("add-note-submit").click();

    const annotations = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.at).toEqual(center);
  });

  test("an agent-invoked submit pins at the map centre and leaves a human's half-placed draft alone; a later human submit still uses it", async ({
    page,
  }) => {
    await goReady(page);
    const center = await page.evaluate(() => window.__glassmapStore!.getState().view.center);

    await page.getByTestId("note-toggle").click();
    await clickMapOffset(page, 150, 0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);
    const target = parseTarget(await page.getByTestId("add-note-target").innerText());
    expect(target).not.toBe("centre");

    await page.getByTestId("add-note-input").fill("an agent submitted this, not the human");

    // The spec's own discriminator (docs/webmcp-reference.md), dispatched
    // directly on the form rather than through a prototype patch + a real
    // click: this marks exactly this one submit as the agent's, without
    // touching how any other submit in this file is attributed.
    await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>('form[toolname="add_note"]')!;
      const submit = new SubmitEvent("submit", { cancelable: true, bubbles: true });
      Object.defineProperty(submit, "agentInvoked", { value: true });
      form.dispatchEvent(submit);
    });

    const afterAgent = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(afterAgent).toHaveLength(1);
    expect(afterAgent[0]!.source).toBe("agent");
    // The regression this test exists to catch: an agent's note routed
    // through the human's draft instead of the centre the tool promises.
    expect(afterAgent[0]!.at).toEqual(center);
    await expect(page.locator('[data-testid="activity-call"][data-tool="add_note"]')).toHaveCount(1);

    // S1 (review fix): an agent's submit never touches the draft -- it did
    // not use it, and must not spend it either. The pin a person is still
    // placing survives the agent's own call untouched, byte for byte.
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);
    expect(parseTarget(await page.getByTestId("add-note-target").innerText())).toEqual(target);

    // The surviving draft is still good for the human's OWN next submit --
    // proof this is a real draft, not a target frozen in the DOM.
    await page.getByTestId("add-note-input").fill("and now the human, using the same draft");
    await page.getByTestId("add-note-submit").click();

    const afterHuman = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(afterHuman).toHaveLength(2);
    expect(afterHuman[1]!.source).toBe("user");
    expect(afterHuman[1]!.at).toEqual(target);

    // NOW the draft is spent -- by the human's submit, not the agent's.
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
  });

  test("the popover suppresses a feature tap and places a draft instead; closed, the same tap opens the card", async ({
    page,
    mockedExternalHosts,
  }) => {
    test.setTimeout(60_000);
    // The bundled data layers' click handlers are only added inside
    // MapLibre's `load` (MapCanvas.tsx), which never fires under this
    // suite's default network isolation (the real basemap CDN is blocked).
    // A minimal-but-valid style response for that same blocked host is
    // enough for `load` to fire without leaking a real network call -- the
    // same escape hatch `place-details.spec.ts` already established for
    // exactly this gap.
    const BASEMAP_HOST = "tiles.openfreemap.org";
    mockExternalHost(mockedExternalHosts, BASEMAP_HOST);
    await page.route(`**/${BASEMAP_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      }),
    );
    await goReady(page);
    await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });

    // Da'an MRT station: bundled base data (public/data/mrt-stations.geojson),
    // loaded from the moment the page's datasets arrive, never through
    // tier-2 -- see inspector-actions.spec.ts's own fixture comment. A
    // selected BUNDLED feature paints a selection ring, not a bead (beads
    // are tier-2/browse only -- bead-style.ts, `selectedPoiFeatures`); the
    // clickable render is the category's own circle layer, so the hit-test
    // below queries `INTERACTIVE_LAYER_IDS`.
    const STATION = { id: "osm:node:3494960748", lng: 121.54355, lat: 25.03333 };
    const selected = await callTool(page, "select_features", { ids: [STATION.id] });
    expect(selected.error).toBeUndefined();
    const view = await callTool(page, "set_map_view", { center: { lng: STATION.lng, lat: STATION.lat }, zoom: 15 });
    expect(view.error).toBeUndefined();

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__glassmapMap!;
          const timer = setTimeout(resolve, 8000);
          map.once("idle", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    );

    const stationPixel = await page.evaluate(
      ({ id, layers }) => {
        const map = window.__glassmapMap!;
        const match = map
          .queryRenderedFeatures({ layers })
          .find((f) => (f.properties as { id?: string })?.id === id && f.geometry.type === "Point");
        if (!match || match.geometry.type !== "Point") return null;
        const projected = map.project(match.geometry.coordinates as [number, number]);
        const hit = map.queryRenderedFeatures([projected.x, projected.y], { layers });
        return hit.some((f) => (f.properties as { id?: string })?.id === id)
          ? { x: projected.x, y: projected.y }
          : null;
      },
      { id: STATION.id, layers: [...INTERACTIVE_LAYER_IDS] },
    );
    if (!stationPixel) {
      throw new Error(`${STATION.id} was not hit-testable at INTERACTIVE_LAYER_IDS after set_map_view zoom 15`);
    }

    // Closed popover: the ordinary tap answers "what is this?".
    await page.mouse.click(stationPixel.x, stationPixel.y);
    const card = page.getByTestId("on-the-map-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-kind", "feature");
    await expect(card).toHaveAttribute("data-card-id", STATION.id);
    await page.getByTestId("otm-close").click();
    await expect(card).toHaveCount(0);

    // Open popover: the same tap is a place-picker's click. No card, and the
    // tap that used to select/open now drops a draft instead.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await page.mouse.click(stationPixel.x, stationPixel.y);
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);
  });

  test("closing the popover, or starting Draw, throws the half-placed draft away", async ({ page }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await clickMapOffset(page, 150, 0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);

    // Closing the popover.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");

    // Reopen, place another draft, then start Draw instead of closing.
    await page.getByTestId("note-toggle").click();
    await clickMapOffset(page, -150, 60);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);

    await page.getByTestId("draw-toggle").click();
    await expect(page.getByTestId("draw-mode")).toHaveText("on");
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
  });

  // S4 (review fix): while the popover is open the map is a place-picker and
  // every tap on a place, bead or shape is suppressed -- before this, a
  // second press on the Note chip was the only way out. Esc is bound at the
  // window, not the popover, because a click on the map (the placing
  // gesture) usually moves focus out of the form onto the canvas.
  test("Escape leaves note mode: it closes the popover, throws the draft away, and returns focus to the Note chip", async ({
    page,
  }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await clickMapOffset(page, 150, 0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
    await expect(page.getByTestId("note-toggle")).toBeFocused();
  });

  test("Escape closes the popover even with the caret inside add-note-input", async ({ page }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await clickMapOffset(page, 150, 0);
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(1);

    // The caret itself, not just a click somewhere on the map: a person may
    // still be mid-sentence in the field when they decide to bail out.
    const input = page.getByTestId("add-note-input");
    await input.click();
    await input.pressSequentially("never mind");
    await input.press("Escape");

    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("note-draft-pin")).toHaveCount(0);
    await expect(page.getByTestId("add-note-target")).toHaveText("centre");
    await expect(page.getByTestId("note-toggle")).toBeFocused();
  });
});

test.describe("T-107 -- a folded note can be unfolded", () => {
  test("a folded pin's bubble and chip fold and unfold it without ever opening a card; the unfolded anchor still does", async ({
    page,
  }) => {
    await goReady(page);

    await page.getByTestId("note-toggle").click();
    await page.getByTestId("add-note-input").fill("fold me and see");
    await page.getByTestId("add-note-submit").click();

    const id = (await page.evaluate(() => window.__glassmapStore!.getState().annotations))[0]!.id;
    const pin = page.locator(`[data-testid="annotation-pin"][data-annotation-id="${id}"]`);
    await expect(pin).toHaveAttribute("data-folded", "false");

    await pin.locator('[data-testid="annotation-popup"]').click();
    await expect(pin).toHaveAttribute("data-folded", "true");
    await expect(pin.locator('[data-testid="annotation-chip"]')).toBeVisible();
    await expect(page.getByTestId("on-the-map-card")).toHaveCount(0);

    await pin.locator('[data-testid="annotation-chip"]').click();
    await expect(pin).toHaveAttribute("data-folded", "false");
    await expect(page.getByTestId("on-the-map-card")).toHaveCount(0);

    await pin.locator(".pin-anchor").click();
    const card = page.getByTestId("on-the-map-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-kind", "annotation");
  });
});

test.describe("T-108 -- the card shows the whole note", () => {
  test("a 200-character note's card shows every character, wrapped rather than cut", async ({ page }) => {
    await goReady(page);

    // Padded to exactly 200 rather than hand-counted, so the assertion below
    // proves the card against exactly 200 characters regardless of how this
    // sentence is phrased.
    const note = "This note is meant to run to exactly two hundred characters, so the on-the-map card must show every one of them without truncation, wrapped rather than clipped, however tall that makes the card.".padEnd(
      200,
      ".",
    );
    expect(note).toHaveLength(200);

    await page.getByTestId("note-toggle").click();
    await page.getByTestId("add-note-input").fill(note);
    await page.getByTestId("add-note-submit").click();

    const id = (await page.evaluate(() => window.__glassmapStore!.getState().annotations))[0]!.id;
    const pin = page.locator(`[data-testid="annotation-pin"][data-annotation-id="${id}"]`);
    await pin.locator(".pin-anchor").click();

    const card = page.getByTestId("on-the-map-card");
    await expect(card).toHaveAttribute("data-kind", "annotation");
    const name = await page.getByTestId("otm-name").innerText();
    expect(name).toBe(note);
    expect(name).toHaveLength(200);
    expect(name).not.toContain("…");
  });

  // S2 (review fix): `annotate` accepts MAX_NOTE_CHARS (500), and every one of
  // those characters may be a newline -- 250 lines of card, which used to run
  // off the top of the map above 640px and could not be scrolled back into
  // view at all below it (`.otm-card` is `position: fixed` against the bottom
  // bar down there). `.otm-name` is now capped at 25vh with its own
  // scrollbar, so the worst case stays reachable and the card itself stays
  // placeable on both tiers.
  for (const viewport of [
    { width: 1440, height: 900, label: "desktop" },
    { width: 390, height: 844, label: "mobile" },
  ]) {
    test(`a pathological 500-character note (every other character a newline) stays scrollable, and the card's edges stay on screen at ${viewport.label} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await goReady(page);

      // Exactly MAX_NOTE_CHARS (500) -- the worst case the tool will accept,
      // not an arbitrary long string.
      const pathological = "a\n".repeat(250);
      expect(pathological).toHaveLength(500);
      const center = await page.evaluate(() => window.__glassmapStore!.getState().view.center);
      const result = await callTool(page, "annotate", {
        at: { lng: center[0], lat: center[1] },
        note: pathological,
      });
      expect(result.error).toBeUndefined();
      const id = result.annotation_id!;

      const pin = page.locator(`[data-testid="annotation-pin"][data-annotation-id="${id}"]`);
      await pin.locator(".pin-anchor").click();

      const card = page.getByTestId("on-the-map-card");
      await expect(card).toHaveAttribute("data-kind", "annotation");

      const nameBox = page.getByTestId("otm-name");
      const { scrollHeight, clientHeight } = await nameBox.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      // The 25vh cap is doing something: the note overflows its own box
      // rather than stretching it to fit every line.
      expect(scrollHeight).toBeGreaterThan(clientHeight);

      const box = await card.boundingBox();
      if (!box) throw new Error("on-the-map-card has no box");
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // Not asked for, but cheap and the more telling half of the same fix at
      // the fixed-bottom-sheet tier (<=640px): an uncapped note grows the
      // card upward from its fixed bottom offset and pushes the top off
      // screen even though the bottom edge alone would still read as fine.
      expect(box.y).toBeGreaterThanOrEqual(0);
    });
  }
});
