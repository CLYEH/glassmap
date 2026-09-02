"use client";

import { useState } from "react";
import { ACTIVITY_NOTE_CHARS } from "@/lib/map-tools/activity";
import { truncate } from "@/lib/map-tools/shapes";
import { useMapStore } from "@/lib/store/map-store";
import { emitHumanFx } from "./fx/human-events";
import { useNoteStore } from "./note-store";

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
 * **Where the note lands depends on who submitted it** (T-106). An agent has no
 * cursor, so an agent's submit pins at `view.center` — the place the tool has
 * always named and the place its description still names. A person has one:
 * while this popover is open, a click on the map places a provisional pin
 * (`note-store.ts`, drawn by MapCanvas) and their submit pins there. Without a
 * click a person gets the centre too, which is the behaviour this form shipped
 * with — panning the map until the spot sits under an invisible crosshair is
 * now the fallback rather than the only way. `add-note-target` reports which of
 * the two is armed, and the status line names the coordinates actually used.
 *
 * Who gets credit for the note comes from `SubmitEvent.agentInvoked`, the
 * spec's own discriminator. Without a WebMCP client there is no such flag and
 * the note is stored as `source: "user"` - the honest default for a form a
 * human typed into, and the one that keeps the sidebar's "pinned by" line and
 * the pin colour truthful.
 *
 * @param focusable whether a person can reach the fields with Tab. The popover
 *   that holds this form is never unmounted - a WebMCP client discovers the
 *   tool by finding `form[toolname]` in the document, and a closed popover that
 *   removed it would delete a tool the badge is still counting (`Tools.tsx`) -
 *   so when it is closed the form is transparent and untouchable by pointer but
 *   still in the tab order. Two invisible tab stops in front of the map is a
 *   keyboard user pressing Tab into nowhere, which is why the controls leave
 *   the order with `tabIndex={-1}` while the popover is shut. They stay
 *   *focusable* (`-1`, not `inert`): the toggle focuses the input itself on
 *   open, and `inert` is the one thing that might also hide the form from a
 *   WebMCP client, which is the worse failure of the two (design2-v5 §8.4
 *   item 4).
 */
export function AddNoteForm({ focusable = true }: { focusable?: boolean }) {
  const [status, setStatus] = useState("");
  const draft = useNoteStore((s) => s.draft);

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
    // The draft is a person's answer to "where", so only a person's submit
    // reads it: `add_note` promises an agent the map centre, and an agent that
    // submits while a human has a pin half-placed must still get the place the
    // tool description names. Read from the store rather than from the
    // subscribed value, so a click that lands in the same tick as the submit
    // cannot pin the note at the place before it.
    const at = agentInvoked ? view.center : (useNoteStore.getState().draft ?? view.center);
    const stored = addAnnotation({
      source: agentInvoked ? "agent" : "user",
      at,
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
    } else {
      // A person pinned this one: the rose half of the same grammar. An
      // agent-submitted note is already a feed row, and the row is what
      // drives its (teal) effect.
      emitHumanFx({ type: "note", annotation: stored });
    }
    setStatus(`Pinned ${stored.id} at ${round5(at[0])}, ${round5(at[1])}.`);
    form.reset();
    // The place is spent with the note a person pinned: the next one starts
    // unplaced rather than stacking silently on the last one's pin. An agent's
    // submit never touches it - the draft belongs to the human who clicked it,
    // and a tool call arriving mid-sentence must not take their pin off the map
    // (it did not use it either: an agent pins at the centre).
    if (!agentInvoked) useNoteStore.getState().clearDraft();
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
      {/* The visible instruction follows the state; the `tooldescription` and
          `toolparamdescription` around it do not, because they are the agent's
          contract and an agent's note still goes to the centre. */}
      <label htmlFor="add-note-input">
        {draft
          ? "Pin a note where you clicked"
          : "Click the map to place a note, or pin it at the centre"}
      </label>
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
          tabIndex={focusable ? undefined : -1}
        />
        <button type="submit" data-testid="add-note-submit" tabIndex={focusable ? undefined : -1}>
          Pin note
        </button>
      </div>
      <p className="note-hint">
        This form is itself a WebMCP tool: <code>add_note</code>
      </p>
      <p data-testid="add-note-status" className="note-status" aria-live="polite">
        {status}
      </p>
      {/* Off screen: which of the two places the next human submit will use,
          without reading a CSS class or measuring a marker. The draft's own
          numbers are already rounded to ~1 m by the store that holds them. */}
      <span data-testid="add-note-target" className="gm-machine">
        {draft ? `${draft[0]}, ${draft[1]}` : "centre"}
      </span>
    </form>
  );
}
