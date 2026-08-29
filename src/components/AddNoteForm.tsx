"use client";

import { useState } from "react";
import { ACTIVITY_NOTE_CHARS } from "@/lib/map-tools/activity";
import { truncate } from "@/lib/map-tools/shapes";
import { useMapStore } from "@/lib/store/map-store";

/** ~1 m, the same precision the tools report coordinates in. */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * The declarative half of T-21: a normal HTML form that a WebMCP-capable
 * browser exposes as the `add_note` tool, with no JavaScript registration at
 * all (`toolname` / `tooldescription` / `toolparamdescription`, see
 * `docs/webmcp-reference.md`). The imperative `annotate` tool is registered in
 * the tool layer; this form is deliberately *not* registered a second time
 * there, so the two APIs stay demonstrably separate.
 *
 * Everywhere else it is just a form a human can type into. Submitting never
 * navigates - the page has no server - and never opens a dialog: the result is
 * written to the store and echoed in `add-note-status`, which is also what an
 * agent reads back after submitting.
 *
 * Who gets credit for the note comes from `SubmitEvent.agentInvoked`, the
 * spec's own discriminator. Without a WebMCP client there is no such flag and
 * the note is stored as `source: "user"` - the honest default for a form a
 * human typed into, and the one that keeps the sidebar's "pinned by" line and
 * the pin colour truthful.
 */
export function AddNoteForm() {
  const [status, setStatus] = useState("");

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("note");
    const note = typeof value === "string" ? value.trim() : "";
    if (!note) {
      setStatus("Type a note first.");
      return;
    }
    const { view, addAnnotation, recordActivity } = useMapStore.getState();
    const agentInvoked = (event.nativeEvent as SubmitEvent).agentInvoked === true;
    const stored = addAnnotation({
      source: agentInvoked ? "agent" : "user",
      at: view.center,
      note,
    });
    // An agent-submitted form is a tool call like any other, and the activity
    // feed says it shows every one. The tool layer cannot record this one --
    // it never goes through `createMapTools` -- so the form reports itself, in
    // the same words `annotate` uses. A human typing here is not agent
    // activity and is deliberately not recorded.
    if (agentInvoked) {
      recordActivity({
        tool: "add_note",
        summary: `Pinned “${truncate(note, ACTIVITY_NOTE_CHARS)}” → ${stored.id}`,
        readOnly: false,
        ok: true,
        refIds: [stored.id],
      });
    }
    setStatus(
      `Pinned ${stored.id} at ${round5(view.center[0])}, ${round5(view.center[1])}.`,
    );
    form.reset();
  };

  return (
    <form
      data-testid="add-note-form"
      toolname="add_note"
      tooldescription="Pin a note to the current map centre"
      toolautosubmit=""
      onSubmit={onSubmit}
      className="note-form"
    >
      <label htmlFor="add-note-input">Pin a note at the map centre</label>
      <div className="note-form-row">
        <input
          id="add-note-input"
          name="note"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          placeholder="e.g. quiet street, good light"
          toolparamdescription="Text of the note to pin at the current map centre"
          data-testid="add-note-input"
        />
        <button type="submit" data-testid="add-note-submit">
          Pin note
        </button>
      </div>
      <p className="note-hint">
        This form is itself a WebMCP tool: <code>add_note</code>
      </p>
      <p data-testid="add-note-status" className="note-status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
