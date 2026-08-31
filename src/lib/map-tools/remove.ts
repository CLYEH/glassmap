/**
 * What `remove_from_map` does to one id, and why the three kinds of id are not
 * three tools.
 *
 * The page already has this gesture: tap a mark, read who made it, press Remove
 * (`components/OnTheMapCard.tsx`). One tap covers a shape, a note and a
 * highlighted feature, because "take this off the map" is one thing a person
 * means. This module is the agent's half of that gesture, and it writes through
 * the same three store calls the card uses — `removeDrawing`,
 * `removeAnnotation`, `setSelection` minus the id — so an undo by hand and an
 * undo by agent leave the store in the same place.
 *
 * Two rules are load-bearing and argued where they are applied below:
 *  - the selection is read first, whatever the feature list says;
 *  - a shape or a note the human made is not the agent's to remove.
 *
 * Nothing here throws, and no per-id problem fails the batch: every id that
 * could not be acted on is accounted for by name, next to the ones that were.
 */
import type { Drawing, MapToolStore } from "@/lib/store/map-store";
import { NOTE_PREVIEW_CHARS, SELECTION_ID_LIMIT } from "./state";
import { MAX_LABEL_CHARS, truncate } from "./shapes";

/** The two kinds of mark this tool can take off the map. */
export type MarkKind = "drawing" | "annotation";

/** A mark, or a feature that was only ever a highlight. */
export type RemoveKind = MarkKind | "selection";

export const DRAWING_PREFIX = "drawing:";
export const ANNOTATION_PREFIX = "annotation:";

/**
 * Ids that were *nearly* a mark id: "drawings:1", "Annotation 2", "drawing 3".
 * They are caught before the feature lookup so a near miss cannot be answered
 * with "no such feature" — the caller would go looking in the wrong place for a
 * shape that is right there on the map, exactly as `measure` guards its own
 * drawing ids.
 */
const NEAR_MISS = [/^drawings?[:\s]/i, /^annotations?[:\s]/i];

export interface RemovedEntry {
  id: string;
  kind: RemoveKind;
  /** Who made it, as recorded. Absent for a selected id nobody claimed. */
  source?: Drawing["source"];
  /** Drawings only, truncated. */
  label?: string;
  /** Annotations only, truncated. */
  note?: string;
}

/** A mark the human made: reported per id, never as a failure of the call. */
export interface RefusedEntry {
  id: string;
  kind: MarkKind;
  source: "user";
  reason: string;
}

/** An id that looks like a mark id but is not written as one. */
export interface MalformedEntry {
  id: string;
  error: string;
}

/**
 * Every id the caller named, accounted for. Lists are capped at
 * SELECTION_ID_LIMIT and each one that is present comes with its true count:
 * a truncated list of refusals that did not say how many there were would be
 * the same silent loss the caps exist to avoid.
 */
export interface RemoveOutput {
  removed: RemovedEntry[];
  removed_count: number;
  refused?: RefusedEntry[];
  refused_count?: number;
  /** Loaded features that were not highlighted: nothing to take out. */
  not_selected?: string[];
  not_selected_count?: number;
  malformed_ids?: MalformedEntry[];
  malformed_count?: number;
  unknown_ids: string[];
  unknown_count: number;
  /** The mark ids that do exist, when a "drawing:"/"annotation:" id missed. */
  known_ids?: string[];
  known_count?: number;
}

const cap = <T>(items: readonly T[]): T[] => items.slice(0, SELECTION_ID_LIMIT);

/**
 * The most recent mark ids and how many there are in all — map state's own
 * rule, because past the cap the oldest ids are the least likely to be the one
 * the caller meant. Shared with `findDrawing` in `index.ts` so an id this layer
 * cannot resolve gets the same answer wherever it was named.
 */
export function knownMarkIds(marks: readonly { id: string }[]): {
  known_ids: string[];
  known_count: number;
} {
  return { known_ids: marks.map((m) => m.id).slice(-SELECTION_ID_LIMIT), known_count: marks.length };
}

/**
 * The same, for the kinds a single call actually missed. Two kinds share the
 * cap rather than one crowding the other out: a call that mistyped both a
 * drawing id and an annotation id needs to see both vocabularies.
 */
function knownMarks(store: MapToolStore, kinds: readonly MarkKind[]) {
  const lists = kinds.map((kind) =>
    kind === "drawing" ? store.getDrawings() : store.getAnnotations(),
  );
  const share = Math.ceil(SELECTION_ID_LIMIT / lists.length);
  return {
    known_ids: lists.flatMap((list) => list.map((m) => m.id).slice(-share)),
    known_count: lists.reduce((n, list) => n + list.length, 0),
  };
}

const malformed = (id: string): MalformedEntry => ({
  id,
  error:
    `${id} is not one of the id forms this tool accepts: a shape is "${DRAWING_PREFIX}<n>", ` +
    `a note is "${ANNOTATION_PREFIX}<n>", and a selected feature is its own id, e.g. "osm:node:123". ` +
    "Map state lists the shape and note ids under drawings and annotations.",
});

const refusal = (kind: MarkKind) =>
  `${kind === "drawing" ? "The human drew this shape by hand" : "The human wrote this note"}, ` +
  "so taking it off the map is theirs to do: they can tap it on the map and press Remove.";

/**
 * Remove each id, in the order it was given. `ids` is trusted to be strings and
 * to be within the schema's length cap; everything else about them is decided
 * here.
 */
export function removeFromMap(store: MapToolStore, ids: readonly string[]): RemoveOutput {
  // Trimmed before it is deduped, so "drawing:1" and " drawing:1 " are one
  // instruction rather than a removal followed by an unknown id.
  const wanted = [...new Set(ids.map((id) => id.trim()))];

  const selection = store.getSelection();
  const selected = new Set(selection);
  const selectionSources = store.getSelectionSources();
  const featureIds = new Set(
    store
      .getFeatures()
      .map((f) => f?.properties?.id)
      .filter((id): id is string => typeof id === "string"),
  );

  const removed: RemovedEntry[] = [];
  const refused: RefusedEntry[] = [];
  const notSelected: string[] = [];
  const malformedIds: MalformedEntry[] = [];
  const unknown: string[] = [];
  const missedKinds = new Set<MarkKind>();
  const deselect = new Set<string>();

  for (const id of wanted) {
    // Selection first, whatever the feature list says. A page opened from a
    // share link can hold selected ids that never resolved — a category that
    // failed permanently leaves them there — and those are precisely the ids a
    // human needs taken out of the highlight. Asking `getFeatures()` first
    // would call them unknown and refuse to remove the one id this tool exists
    // for. Nothing ever puts a mark id in the selection, so the mark branches
    // below lose nothing by coming second.
    if (selected.has(id)) {
      deselect.add(id);
      const source = selectionSources[id];
      removed.push({ id, kind: "selection", ...(source ? { source } : {}) });
      continue;
    }

    if (id.startsWith(DRAWING_PREFIX)) {
      const drawing = store.getDrawings().find((d) => d.id === id);
      if (!drawing) {
        unknown.push(id);
        missedKinds.add("drawing");
      } else if (drawing.source === "user") {
        refused.push({ id, kind: "drawing", source: "user", reason: refusal("drawing") });
      } else {
        store.removeDrawing(id);
        removed.push({
          id,
          kind: "drawing",
          source: drawing.source,
          ...(drawing.label ? { label: truncate(drawing.label, MAX_LABEL_CHARS) } : {}),
        });
      }
      continue;
    }

    if (id.startsWith(ANNOTATION_PREFIX)) {
      const annotation = store.getAnnotations().find((a) => a.id === id);
      if (!annotation) {
        unknown.push(id);
        missedKinds.add("annotation");
      } else if (annotation.source === "user") {
        refused.push({ id, kind: "annotation", source: "user", reason: refusal("annotation") });
      } else {
        store.removeAnnotation(id);
        removed.push({
          id,
          kind: "annotation",
          source: annotation.source,
          note: truncate(annotation.note, NOTE_PREVIEW_CHARS),
        });
      }
      continue;
    }

    if (NEAR_MISS.some((form) => form.test(id))) {
      malformedIds.push(malformed(id));
      continue;
    }

    // A loaded feature that is not highlighted is a different fact from an id
    // nothing on this map answers to: there is nothing to take out, and the
    // agent has no bad id to go and fix.
    if (featureIds.has(id)) notSelected.push(id);
    else unknown.push(id);
  }

  if (deselect.size) {
    // Only the named ids leave. Every other id stays, resolvable or not:
    // `select_features` prunes ids it cannot resolve, which here would drop a
    // share link's still-loading (or permanently failed) ids as a side effect
    // of removing something else — and the address bar is rewritten from the
    // store, so the recipient's own link would carry the loss on. Attribution
    // is omitted because this write knows nothing new about who chose the ids
    // that remain; they keep their record (`map-store.ts`, `setSelection`).
    store.setSelection(selection.filter((id) => !deselect.has(id)));
  }

  return {
    removed: cap(removed),
    removed_count: removed.length,
    ...(refused.length ? { refused: cap(refused), refused_count: refused.length } : {}),
    ...(notSelected.length
      ? { not_selected: cap(notSelected), not_selected_count: notSelected.length }
      : {}),
    ...(malformedIds.length
      ? { malformed_ids: cap(malformedIds), malformed_count: malformedIds.length }
      : {}),
    unknown_ids: cap(unknown),
    unknown_count: unknown.length,
    // Map state lists only the ten most recent marks, so an agent that guessed
    // an id has no way to enumerate the rest from state alone.
    ...(missedKinds.size ? knownMarks(store, [...missedKinds]) : {}),
  };
}
