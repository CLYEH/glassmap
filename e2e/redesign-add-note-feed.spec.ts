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
import { waitForTools } from "./helpers";

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

  test("a plain human submit creates the note but records zero add_note activity rows", async ({
    page,
  }) => {
    // No SubmitEvent patch: this is what an ordinary visitor's browser does.
    await page.goto("/");
    await waitForTools(page);

    await page.getByTestId("add-note-input").fill("a human typed this note");
    await page.getByTestId("add-note-submit").click();
    await expect(page.getByTestId("add-note-status")).not.toHaveText("");

    await expect(
      page.locator('[data-testid="activity-call"][data-tool="add_note"]'),
    ).toHaveCount(0);

    // Still created -- a human filling in a form is not a defect, and the
    // Notes list (Inspector.tsx) must show it labelled "user".
    const annotations = await page.evaluate(() => window.__glassmapStore!.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.source).toBe("user");
    await expect(page.getByTestId("sidebar-annotations-count")).toHaveText("1");
  });
});
