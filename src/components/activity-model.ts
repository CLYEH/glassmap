/**
 * What the activity feed renders. The slice itself is written by the tool
 * layer (`src/lib/store/map-store.ts`, filled from the `createMapTools`
 * execute path): one entry per tool call, newest LAST, capped at 50.
 *
 * This file is the UI's half of that contract — the shape it reads, and the
 * pure formatting it does to it. Everything here is a deterministic string
 * transform: no model is in the loop, and the feed never reorders a call.
 */
export interface ActivityEntry {
  /** 1-based, assigned by the store; survives the cap, so it is the call number. */
  seq: number;
  tool: string;
  /** One line, written by the tool layer from the call's input and result. */
  summary: string;
  /** A read tool changed nothing; the dot is hollow. */
  readOnly: boolean;
  ok: boolean;
  /** `Date.now()` at the moment the call returned. */
  at: number;
  /** Ids the call produced or acted on, e.g. `drawing:1`. */
  refIds?: string[];
}

/** Stable empty reference: the slice may not exist yet on a page load. */
export const NO_ACTIVITY: readonly ActivityEntry[] = [];

interface MaybeActivity {
  activity?: readonly ActivityEntry[];
}

/**
 * Read the slice out of the store without assuming it is there. Returning one
 * shared empty array matters: a fresh `[]` per call would make every zustand
 * selector look changed and re-render the feed on every unrelated store write.
 *
 * The parameter is widened because the slice is the tool layer's to declare:
 * this selector has to compile against a store that does not have the field
 * yet, and keep working the moment it does.
 */
export function selectActivity(state: object): readonly ActivityEntry[] {
  return (state as MaybeActivity).activity ?? NO_ACTIVITY;
}

/** HH:MM:SS in the reader's own clock — the same wall time they watched. */
export function formatCallTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function callCountLabel(count: number): string {
  return `${count} ${count === 1 ? "call" : "calls"}`;
}

/** One rendered line of the feed. `folded` is 1 for an ordinary call. */
export interface ActivityRow {
  /** The newest entry the row stands for. */
  entry: ActivityEntry;
  /** How many consecutive read calls this row represents. */
  folded: number;
}

/** A run of this many consecutive reads is worth one row instead of many. */
export const FOLD_READS_FROM = 3;

/**
 * Fold runs of consecutive successful read calls into a single row.
 *
 * An agent that polls `get_map_state` between every step can push a run of
 * identical reads through the feed, and since the slice is capped at 50 those
 * reads also crowd out the writes — the rows that say what actually changed.
 * Folding is a rendering decision only: the store keeps every entry, the row
 * shows the newest of the run, and the ×n says exactly how many it stands for.
 *
 * Writes are never folded, and neither is a failed read: both are the kind of
 * thing someone is reading the feed to find.
 */
export function groupActivity(
  activity: readonly ActivityEntry[],
  minRun = FOLD_READS_FROM,
): ActivityRow[] {
  const foldable = (entry: ActivityEntry) => entry.readOnly && entry.ok;
  const rows: ActivityRow[] = [];
  let index = 0;
  while (index < activity.length) {
    if (!foldable(activity[index])) {
      rows.push({ entry: activity[index], folded: 1 });
      index += 1;
      continue;
    }
    let end = index;
    while (end < activity.length && foldable(activity[end])) end += 1;
    const run = end - index;
    if (run >= minRun) {
      rows.push({ entry: activity[end - 1], folded: run });
    } else {
      for (let i = index; i < end; i += 1) rows.push({ entry: activity[i], folded: 1 });
    }
    index = end;
  }
  return rows;
}

export interface SummarySegment {
  text: string;
  /** Ids are set in the mono face, the way the tools write them. */
  code: boolean;
}

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Split a summary so the ids it mentions can be typeset as code.
 *
 * The ids come from the entry's own `refIds` rather than from a pattern: a
 * note's text is user or agent content and may well contain something that
 * looks like `word:1`, and quoted prose must not be restyled as machine output.
 */
export function splitSummary(summary: string, refIds?: readonly string[]): SummarySegment[] {
  const ids = (refIds ?? []).filter((id) => id.length > 0);
  if (ids.length === 0) return [{ text: summary, code: false }];
  const pattern = new RegExp(`(${ids.map(escapeForRegExp).join("|")})`, "g");
  return summary
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, code: ids.includes(part) }));
}
