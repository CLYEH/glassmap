/**
 * T-54 -- `add_note` (the declarative form, AddNoteForm.tsx) is the one tool
 * this page never registers through `document.modelContext`; a WebMCP client
 * discovers it from the `<form toolname="add_note">` markup itself and marks
 * the SubmitEvent it dispatches with `agentInvoked`. The activity feed is
 * supposed to show that call exactly like any other -- but only when the
 * form really was agent-invoked, never for an ordinary human filling in the
 * same box (AddNoteForm.tsx's own comment: "A human typing here is not
 * agent activity and is deliberately not recorded").
 *
 * `SubmitEvent.prototype.agentInvoked` is not something Playwright's
 * `page.click()` can set on its own -- it is the spec's own discriminator,
 * read directly off the native event -- so the agent-invoked branch is
 * simulated by patching the prototype getter before the page loads, exactly
 * the technique the handoff calls for.
 */
import { expect, test } from "./fixtures";
import { waitForLiveMap, waitForTools } from "./helpers";

test.describe("add_note -> activity feed (T-54)", () => {
  test("the add_note form is declared exactly once", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await expect(page.locator('form[toolname="add_note"]')).toHaveCount(1);
  });

  test("an agent-invoked submit is recorded as exactly one add_note activity row", async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(SubmitEvent.prototype, "agentInvoked", { get: () => true }),
    );
    await page.goto("/");
    await waitForTools(page);

    // T-82 chrome flip: the note form now lives in a closed popover
    // (opacity:0, pointer-events:none) until note-toggle opens it.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await page.getByTestId("add-note-input").fill("agent submitted this note");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");

    await expect(
      page.locator('[data-testid="activity-call"][data-tool="add_note"]'),
    ).toHaveCount(1);

    // The annotation itself must exist either way -- this test only tells
    // apart whether the FEED noticed, not whether the note was pinned.
    const annotations = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.source).toBe("agent");
  });

  test("a plain human submit creates a note the human can see, attributed to them, with zero agent activity", async ({
    page,
  }) => {
    // PRODUCT RULING (T-85, following T-82's chrome flip): in idle chrome the
    // human's note surface is the map pin (annotation-marker.ts) plus the "On
    // the map" card (OnTheMapCard.tsx) that opens when its anchor is tapped --
    // NOT the Inspector, which is agent chrome and stays unmounted
    // (`{awake ? <Inspector /> : null}`, page.tsx) until an `activity` row
    // exists. A plain human submit through AddNoteForm.tsx deliberately never
    // calls `recordActivity` (that file's own comment), so chrome must stay
    // "idle" for the whole of this scenario -- there is no `activity-call`
    // row, no Inspector, no `sidebar-annotations-count` to read. What a human
    // filling in the form by hand DOES get, and what this test asserts
    // instead, is the pin `emitHumanFx` already draws and the card that
    // answers a tap on it: `data-kind="annotation"`, `data-provenance="user"`,
    // the note text, and a working Remove -- browser-proven in T-82's fix
    // round. `annotation-count` (StateOverlay's chrome-independent
    // `gm-machine` mirror) stands in for "the human can see it" wherever the
    // assertion does not need the DOM pin itself.

    // No SubmitEvent patch: this is what an ordinary visitor's browser does.
    await page.goto("/");
    await waitForTools(page);
    await waitForLiveMap(page);

    // T-82 chrome flip: the note form now lives in a closed popover
    // (opacity:0, pointer-events:none) until note-toggle opens it.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await page.getByTestId("add-note-input").fill("a human typed this note");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");
    // Close it again, the way a person would once they are done -- and so it
    // cannot overlap the pin this note just placed at the map's centre.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "false");

    await expect(
      page.locator('[data-testid="activity-call"][data-tool="add_note"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId("annotation-count")).toHaveText("1");
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).not.toBe("awake");

    // Still created -- a human filling in a form is not a defect -- and
    // labelled "user", the same fact the card is about to read back.
    const annotations = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.source).toBe("user");
    const noteId = annotations[0]!.id;

    // The pin itself: a MapLibre `Marker` element, kept in sync independently
    // of the basemap style (MapCanvas.tsx: "Markers do not need the style, so
    // they are kept in sync from the start") -- it exists under this suite's
    // default network isolation exactly as it would with a live basemap.
    const pin = page.locator(`[data-testid="annotation-pin"][data-annotation-id="${noteId}"]`);
    await expect(pin).toBeVisible();
    // The pin's own note card sits on top of the anchor by default (see
    // annotation-marker.ts); tap the anchor dot specifically, which is what
    // asks the "what is this" question `tapAnnotation` answers, rather than
    // the card, whose own click target just folds it away.
    await pin.locator(".pin-anchor").click();

    const card = page.getByTestId("on-the-map-card");
    await expect(card).toHaveAttribute("data-kind", "annotation");
    await expect(card).toHaveAttribute("data-provenance", "user");
    await expect(page.getByTestId("otm-name")).toHaveText("a human typed this note");

    await page.getByTestId("otm-remove").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("annotation-count")).toHaveText("0");
    // Removing a human's own note by hand is not agent activity either.
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).not.toBe("awake");
  });
});
