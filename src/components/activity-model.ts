/**
 * The UI's half of the agent-activity contract: the pure formatting the feed
 * does to the slice the tool layer writes (`ActivityEntry` in the store, one
 * entry per call, newest LAST, capped at ACTIVITY_LIMIT).
 *
 * Everything here is a deterministic string transform: no model is in the
 * loop, the feed never reorders a call, and summaries are rendered as text
 * nodes — they echo OSM and human wording on purpose.
 */
import type { ActivityEntry } from "@/lib/store/map-store";

export type { ActivityEntry };

/**
 * Where the feed reads its rows. One named selector rather than four inline
 * ones, so the components never have to know which store field this is; the
 * store's own array is returned as-is, because zustand compares selector
 * results by identity and a copy would re-render the feed on every write.
 */
export function selectActivity(state: {
  activity: readonly ActivityEntry[];
}): readonly ActivityEntry[] {
  return state.activity;
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
