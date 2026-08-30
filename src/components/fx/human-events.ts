/**
 * The human's three gestures, announced where they happen.
 *
 * The agent's effects come off the activity feed, which is exactly the right
 * source for them: the feed IS the record of what an agent did. A person's own
 * gesture makes no feed row — it is not agent activity, and the feed must not
 * claim it was — so the three human effects are told directly by the three
 * places a person can act: finishing a hand-drawn polygon (`draw-store.ts`),
 * submitting the note form by hand (`AddNoteForm.tsx`) and pressing ✕ in the
 * inspector (`Inspector.tsx`).
 *
 * Deliberately NOT a diff of the store's `drawings`/`annotations` arrays:
 * opening a share link appends every shape the link carried, one store write at
 * a time, and a diff would replay them as if a person had just drawn them.
 */
import type { HumanEvent } from "./plan";

export type { HumanEvent };

type Listener = (event: HumanEvent) => void;

const listeners = new Set<Listener>();

export function emitHumanFx(event: HumanEvent): void {
  for (const listener of [...listeners]) listener(event);
}

export function onHumanFx(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
