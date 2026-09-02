"use client";

import { useCallback, useRef } from "react";
import { AddNoteForm } from "./AddNoteForm";
import { DrawHint, DrawPill } from "./DrawToolbar";
import { useNoteStore } from "./note-store";
import { ShareChip } from "./ShareChip";

/**
 * The three things a person can do to this map, in one row: Draw, Note, Share.
 *
 * They are the human half of the repositioning (BRIEF item 3) and they are on
 * screen in both chromes — an agent arriving does not take the map away from
 * the person watching it. The row sits opposite the brand and steps aside for
 * the inspector lane when the agent chrome is up (globals.css).
 *
 * The draw switch, the note form and the copy chip are the ones that shipped,
 * re-skinned into pills and given a home that survives the agent panels being
 * hidden. The note form especially — it is the declarative `add_note` WebMCP
 * tool, and it used to live in the inspector, which no longer exists on a page
 * no agent has touched.
 *
 * Whether the note popover is open is the one piece of this row's state that is
 * not this row's business alone: while it is open the map is a place-picker,
 * and a click on it places the pin the note will be written at (T-106). So it
 * lives in `note-store.ts` beside the drawing draft, where MapCanvas can
 * subscribe to it imperatively without this component re-rendering the map.
 */
export function Tools() {
  const noteOpen = useNoteStore((s) => s.open);
  const setNoteOpen = useNoteStore((s) => s.setOpen);
  const inputRef = useRef<HTMLDivElement>(null);

  const toggleNote = useCallback(() => {
    // Read through the store rather than the rendered value: `setOpen` also
    // throws away any half-placed pin, and doing that against a stale answer
    // would leave a pin on the map with no popover to pin it from.
    const next = !useNoteStore.getState().open;
    setNoteOpen(next);
    // Focus after paint: the popover is opacity-hidden rather than unmounted
    // (see below), so the input exists either way — but focusing it while it is
    // still transparent puts the caret somewhere invisible.
    if (next) {
      requestAnimationFrame(() => inputRef.current?.querySelector("input")?.focus());
    }
  }, [setNoteOpen]);

  return (
    <>
      <div className="tools" data-testid="tools">
        <DrawPill />
        <button
          type="button"
          className="tool-chip lg lens"
          data-testid="note-toggle"
          aria-expanded={noteOpen}
          onClick={toggleNote}
        >
          <svg className="rose" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M7 13s4.6-4 4.6-7.4a4.6 4.6 0 10-9.2 0C2.4 9 7 13 7 13z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="7" cy="5.6" r="1.4" fill="currentColor" />
          </svg>
          <span className="lbl">Note</span>
        </button>
        <ShareChip />
      </div>

      <DrawHint />

      {/*
        Never unmounted, never `display: none`, and never `hidden`: this is the
        declarative `add_note` tool, and a WebMCP client discovers it by finding
        `form[toolname]` in the document. A closed popover that took the form
        out of the DOM would silently delete a tool the badge is still counting.
        Closed means transparent and untouchable (globals.css), which is the
        design's own staging — minus `inert`, which is owner-gated: whether it
        also hides a declarative tool from the client is an open verification
        item (design2-v5 §8.4 item 4), and the failure it would cause is worse
        than the one it prevents. What a closed popover *does* give up is the
        tab order: `focusable` takes its two controls out of it, so Tab from
        the Note chip goes to Share rather than into an invisible text field.
      */}
      <div
        ref={inputRef}
        className="note-pop lg deep"
        data-testid="note-popover"
        data-open={noteOpen}
      >
        <AddNoteForm focusable={noteOpen} />
      </div>
    </>
  );
}
