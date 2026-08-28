"use client";

import { useState } from "react";
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
    const { view, addAnnotation } = useMapStore.getState();
    const agentInvoked = (event.nativeEvent as SubmitEvent).agentInvoked === true;
    const stored = addAnnotation({
      source: agentInvoked ? "agent" : "user",
      at: view.center,
      note,
    });
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
      className="flex flex-col gap-1"
    >
      <label htmlFor="add-note-input" className="font-medium">
        Pin a note at the map centre
      </label>
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
        className="rounded border border-zinc-300 px-2 py-1 font-sans"
      />
      <button
        type="submit"
        data-testid="add-note-submit"
        className="self-start rounded bg-zinc-800 px-2 py-1 font-sans font-medium text-white hover:bg-zinc-700"
      >
        Pin note
      </button>
      <p data-testid="add-note-status" className="text-zinc-600" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
