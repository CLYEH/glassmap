"use client";

import { useState } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { restoredChipCopy } from "./restored-model";

/**
 * "Restored from a link" — the one sentence a page opened from somebody else's
 * URL owes the person reading it.
 *
 * Without it a restored map is indistinguishable from a map this visitor made:
 * places selected they never picked, shapes they never drew, and — on a link
 * that carries agent work — agent chrome on a page no agent has touched *here*.
 * The chip says where the state came from, once, quietly, above the map.
 *
 * Two wordings, decided by evidence rather than by mood (`restored-model.ts`):
 * a link whose drawings or notes carry an agent `source` has proof and may say
 * "includes agent actions"; a selection-only link says the plain sentence,
 * because a `su`-less wire cannot tell "legacy" from "all-agent" and a chip is
 * a claim surface like any other.
 *
 * Its own component rather than another line in `ShareRestoreNotice`: that one
 * is a *failure* notice (a category file the link asked for and this page could
 * not load) and lives in the corner with the attribution. This is a statement
 * about provenance, it sits at the top of the map where the eye lands first,
 * and the two must not learn each other's conditions.
 *
 * Dismissible, and dismissed for good: it is disclosure, not a warning, and a
 * person who has read it should be able to put it away without it coming back
 * on the next store write.
 */
export function RestoredChip() {
  const copy = useMapStore(restoredChipCopy);
  const [dismissed, setDismissed] = useState(false);

  if (copy === null || dismissed) return null;

  return (
    <div className="restored-chip lg" data-testid="restored-chip">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M5.5 8.5l3-3M4 10l-1.6 1.6a2.4 2.4 0 01-3.4-3.4L1.5 6.6M9.9 7.4l1.7-1.7a2.4 2.4 0 10-3.4-3.4L6.5 4"
          stroke="currentColor"
          strokeWidth="1.4"
          transform="translate(1 1)"
        />
      </svg>
      {copy}
      <button
        type="button"
        className="x"
        data-testid="restored-chip-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
