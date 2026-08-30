import type { Annotation, Drawing, SelectionSource } from "@/lib/store/map-store";

/**
 * What a restored page is allowed to say about the link it came from.
 *
 * The wire carries a camera, a selection, drawings, annotations and categories
 * — and **no activity** (`lib/map-tools/share.ts`). So a recipient's feed has
 * no calls to show, ever: whatever the sender's agent did, none of it rode the
 * link. The design's answer (design2-v5 §2.6, r4 finding 1) is one synthesized
 * row that claims exactly what the decoded objects prove — counts, and the
 * fact that they were decoded — and nothing else. It is deliberately *not* a
 * call row: no tool name, no timestamp, no write dot, and the mono
 * tool + timestamp + ids law that binds call rows does not reach it.
 *
 * ## Why the counts are latched
 *
 * "The link carried 42 selected" is a claim about the past. Read live off the
 * store it would follow the map: select one more place and the sentence would
 * quietly become "43", which is a lie about a link that is already gone. So
 * the counts are taken once — at the first read after the restore flag is set,
 * which is the commit `applyShareHash` produces (flag first, then content,
 * then this) — and never move again.
 */

/** The three things a link can carry that a person can count. */
export interface RestoredCounts {
  selected: number;
  shapes: number;
  notes: number;
}

/** The slice of the store these sentences are about. */
export interface RestoredState {
  restoredAgentState: boolean;
  selection: readonly string[];
  drawings: readonly Pick<Drawing, "source">[];
  annotations: readonly Pick<Annotation, "source">[];
}

let latched: RestoredCounts | null = null;

/** Tests and the dev harness only: a document restores from one link. */
export function resetRestoredLatch(): void {
  latched = null;
}

function countsOf(state: RestoredState): RestoredCounts {
  return {
    selected: state.selection.length,
    shapes: state.drawings.length,
    notes: state.annotations.length,
  };
}

/**
 * The counts as they were when the link was opened, or null on a page that did
 * not open one.
 */
export function restoredCounts(state: RestoredState): RestoredCounts | null {
  if (!state.restoredAgentState) return null;
  if (latched === null) latched = countsOf(state);
  return latched;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "42 selected · 1 shape · 1 note" — empty parts dropped, never zero-padded. */
export function countsSentence(counts: RestoredCounts): string | null {
  const parts: string[] = [];
  if (counts.selected > 0) parts.push(`${counts.selected} selected`);
  if (counts.shapes > 0) parts.push(plural(counts.shapes, "shape"));
  if (counts.notes > 0) parts.push(plural(counts.notes, "note"));
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * The feed's one synthesized row. Null when there is nothing to count, which
 * `restoredAgentStateOf` makes nearly impossible (it needs an agent-sourced
 * shape, note or unattributed selected id to be true at all) — but a row
 * reading "The link carried" and then stopping would be worse than no row.
 */
export function restoredSummary(state: RestoredState): string | null {
  const counts = restoredCounts(state);
  if (!counts) return null;
  const sentence = countsSentence(counts);
  return sentence === null ? null : `The link carried ${sentence}`;
}

/** The same fact in the phone's one line of chrome. */
export function restoredTicker(state: RestoredState): string | null {
  const counts = restoredCounts(state);
  if (!counts) return null;
  const sentence = countsSentence(counts);
  return sentence === null ? null : `Restored from a link — ${sentence}`;
}

/**
 * The chip's two wordings, and the evidence that decides between them
 * (design2-v5 §2.5).
 *
 * "…includes agent actions" is a claim, and a claim needs evidence. A drawing
 * or a note carries its `source` on the wire and has since the codec shipped,
 * so an agent-sourced one of either is proof. A *selection* is not: a link
 * without `su` cannot be split into "legacy link" vs "all-agent link from a
 * new encoder" — byte-identity is the price of the codec's compatibility — so
 * a selection-only link says the plain sentence and claims nothing about who
 * selected. The beads stay teal in both branches (Ruling 3: false-rose would
 * hide agent involvement, the harmful error; false-teal only over-credits).
 */
export function restoredChipCopy(state: RestoredState): string | null {
  if (!state.restoredAgentState) return null;
  const proven =
    state.drawings.some((d) => d.source === "agent") ||
    state.annotations.some((a) => a.source === "agent");
  return proven ? "Restored from a link · includes agent actions" : "Restored from a link";
}

/**
 * Who selected a place, when the page is asked to say it out loud.
 *
 * Recorded sources win: `selectionSources` is written at the moment of the
 * selection by whoever made it (the agent's `select_features`, the human's
 * click), and the map never guesses a source it was handed. The evidence bit
 * governs the *unrecorded* ids only — everything a link brought in without
 * naming an owner. Explicit (`su` present, so the ids outside it are
 * recorded-agent) → "AGENT"; absent → "FROM LINK", which claims the link and
 * not the agent.
 *
 * The identical rule lives in `card-model.ts` for the tapped card, deliberately
 * as one sentence each rather than one shared helper with two callers: they are
 * the same *policy* stated on two surfaces, and the card's version also decides
 * a colour. If they ever disagree, that is a bug either way — the tests below
 * and `card-model.test.ts` both encode it.
 */
export type SelectionClaim = "YOU" | "AGENT" | "FROM LINK";

export function selectionClaim(
  selection: readonly string[],
  sources: Readonly<Record<string, SelectionSource>>,
  attributionExplicit: boolean,
): SelectionClaim | null {
  if (selection.length === 0) return null;
  const claims = new Set<SelectionClaim>();
  for (const id of selection) {
    const recorded = sources[id];
    if (recorded === "user") claims.add("YOU");
    else if (recorded === "agent") claims.add("AGENT");
    else claims.add(attributionExplicit ? "AGENT" : "FROM LINK");
  }
  // A mixed selection gets no tag at all. One word cannot be true of a list
  // whose rows have different owners, and the design stages no mixed wording
  // for this surface — the card a person taps says it per mark instead.
  return claims.size === 1 ? [...claims][0] : null;
}
