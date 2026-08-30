/**
 * T-54 -- the experience case's payoff: a link built from a mix of agent- and
 * human-made map content, opened in a fresh window, must still tell the two
 * apart on screen.
 *
 * `share-link.spec.ts` already proves the *data* round trip -- the JSON
 * `get_map_state` returns keeps each drawing/annotation's `source` field
 * (T-31). This file is the part that is new with the Smoked Glass redesign
 * (PR #36): does the recipient's actual Inspector DOM -- the thing a human at
 * a demo is looking at, not the tool's JSON -- say "agent" or "user" next to
 * the right item. If it does not, the whole "we made this" story falls apart
 * on the one screen a judge is watching.
 *
 * Items are told apart by their label/note text (unique per test), not by
 * their store-assigned id: both the sending and the receiving store start
 * fresh and assign ids in creation order, so ids match on both sides for
 * this build -- but a test that keyed off ids would be coupled to that
 * numbering coincidence, not to the thing the demo actually shows.
 */
import type { Page } from "@playwright/test";
import { callTool } from "./mcp";
import { blockExternalNetwork, expect, test } from "./fixtures";
import { waitForFeatures, waitForStoreHandle, waitForTools } from "./helpers";

const CENTER = { lng: 121.5175, lat: 25.0478 };

/** The `<li>` in the Shapes list whose title/meta text contains `label`. */
function drawingRow(page: Page, label: string) {
  return page.locator('[data-testid="sidebar-drawings"] li').filter({ hasText: label });
}

/** The `<li>` in the Notes list whose note text contains `text`. */
function noteRow(page: Page, text: string) {
  return page.locator('[data-testid="sidebar-annotations"] li').filter({ hasText: text });
}

test.describe("share-link provenance gate (T-54)", () => {
  test("a link mixing agent and human drawings/notes still labels each correctly for the recipient", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    // --- agent-authored content, through the tool surface -----------------
    const agentDrawing = await callTool(page, "draw_shape", {
      type: "circle",
      center: CENTER,
      radius_m: 300,
      label: "agent circle",
    });
    expect(agentDrawing.error).toBeUndefined();

    const agentNote = await callTool(page, "annotate", {
      at: CENTER,
      note: "agent pinned this note",
    });
    expect(agentNote.error).toBeUndefined();

    // --- human-authored content ---------------------------------------
    // A human drawing has no scripted mouse path across a real map in this
    // suite; the dev store handle is the established entry point for it (see
    // share-link.spec.ts's own round-trip test).
    const humanDrawing = await page.evaluate((center) =>
      window.__glassmapStore!.getState().addDrawing({
        source: "user",
        kind: "polygon",
        label: "human polygon",
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
    CENTER);
    expect(humanDrawing.source).toBe("user");

    // A human note goes through the real AddNoteForm submit path with no
    // `agentInvoked` flag -- the honest default for a form a human typed
    // into (AddNoteForm.tsx).
    // T-82 chrome flip: the note form now lives in a closed popover
    // (opacity:0, pointer-events:none) until note-toggle opens it.
    await page.getByTestId("note-toggle").click();
    await expect(page.getByTestId("note-popover")).toHaveAttribute("data-open", "true");
    await page.getByTestId("add-note-input").fill("human pinned this note");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");

    // A selection, so "selection if set" has something to actually check.
    const selected = await callTool(page, "select_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });
    expect(selected.error).toBeUndefined();
    const selectionCount = selected.state!.selection.count;
    expect(selectionCount).toBeGreaterThan(0);

    await expect(page.getByTestId("drawing-count")).toHaveText("2");
    await expect(page.getByTestId("annotation-count")).toHaveText("2");

    // Sanity: the labels are correct on the SENDING page before we even
    // build a link -- if this fails, the round trip below cannot be trusted
    // to say anything about sharing specifically.
    await expect(drawingRow(page, "agent circle").locator(".obj-meta")).toContainText("agent");
    await expect(drawingRow(page, "human polygon").locator(".obj-meta")).toContainText("user");
    await expect(noteRow(page, "agent pinned this note").locator(".obj-meta")).toContainText("agent");
    await expect(noteRow(page, "human pinned this note").locator(".obj-meta")).toContainText("user");

    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    expect(share.url).toBeDefined();

    // --- open the link as a fresh recipient would ------------------------
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    // A fresh context is not covered by fixtures.ts's auto-block (T-13).
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await page2.goto(share.url!);
    await waitForTools(page2);
    await waitForFeatures(page2);

    await expect(page2.getByTestId("drawing-count")).toHaveText("2");
    await expect(page2.getByTestId("annotation-count")).toHaveText("2");
    await expect(page2.getByTestId("selection-count")).toHaveText(String(selectionCount));

    // THE PAYOFF. Every item's provenance, in the live DOM the recipient is
    // actually looking at -- not the tool's JSON, which share-link.spec.ts
    // already covers.
    await expect(drawingRow(page2, "agent circle").locator(".obj-meta")).toContainText("agent");
    await expect(drawingRow(page2, "human polygon").locator(".obj-meta")).toContainText("user");
    await expect(noteRow(page2, "agent pinned this note").locator(".obj-meta")).toContainText("agent");
    await expect(noteRow(page2, "human pinned this note").locator(".obj-meta")).toContainText("user");

    await context2.close();
    expect(errors2).toEqual([]);
  });
});
