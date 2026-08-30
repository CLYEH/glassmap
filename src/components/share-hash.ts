import {
  MAX_SHARE_URL_BYTES,
  decodeShareState,
  encodeShareState,
  restoredAgentStateOf,
  restoredSelectionSources,
  selectionAttributionExplicit,
  userSelectedIds,
  utf8Bytes,
  type ShareAnnotation,
  type ShareDrawing,
  type ShareState,
} from "@/lib/map-tools/share";
import type {
  Annotation,
  Drawing,
  MapView,
  SelectionAttribution,
  SelectionSource,
} from "@/lib/store/map-store";
import {
  shareCategories,
  type Tier2Category,
  type Tier2RestoreFailure,
} from "@/lib/store/tier2";

/**
 * How long the map has to stand still before its state goes into the address
 * bar. A pan is a stream of `moveend`s and a drawn polygon is a stream of
 * `addDrawing`s; encoding on each one would burn a base64 pass per frame and
 * still end up writing the same final string.
 *
 * It is also a rate limit, not only a performance knob: WebKit throws a
 * SecurityError past roughly 100 history writes in 30 s, and this floor keeps
 * a continuously moving map at the edge of that budget rather than over it.
 * Lowering it trades an address bar that keeps up for one that stops entirely.
 */
export const SHARE_WRITE_DEBOUNCE_MS = 300;

/**
 * What `share-status` says when the map has outgrown a URL. Deliberately about
 * the *link*, not about the map: nothing has been lost, only the address bar
 * has stopped following along.
 */
export const SHARE_TOO_LARGE_MESSAGE = "state too large for the link";

export interface HashUpdate {
  /** The fragment to write (no leading "#"), or null when the URL must not change. */
  hash: string | null;
  /** The state no longer fits in a URL, so the address bar keeps the last one that did. */
  tooLarge: boolean;
  /** Size of the whole URL this state would produce, the number the limit applies to. */
  bytes: number;
}

/**
 * Decide what, if anything, the address bar should say about the current map.
 *
 * Pure on purpose: the hook around it owns `location` and `history`, this owns
 * the two decisions that can be wrong. Both are guards, and both matter:
 *
 *  - **No-change.** `encodeShareState` is deterministic, so re-encoding a map
 *    nobody touched reproduces the same string byte for byte (see the module
 *    header of `map-tools/share.ts`). String equality is therefore a sound
 *    "nothing happened" test, and it is the only thing standing between a map
 *    that reports its own camera back after every gesture and a `replaceState`
 *    per `moveend`.
 *  - **Budget.** The limit is on the URL, not on the fragment: the same map is
 *    shareable from `/` and not from a long path. `baseUrl` is measured with
 *    the hash so the address bar can never hold a link `get_share_link` would
 *    have refused to hand out. When it does not fit we write nothing at all —
 *    the previous fragment still restores a real map, a truncated one restores
 *    nothing.
 *
 * @param baseUrl the current URL without its fragment (origin + path + query)
 * @param currentHash `location.hash`, with or without its leading "#"
 */
export function planHashUpdate(
  state: ShareState,
  baseUrl: string,
  currentHash: string,
): HashUpdate {
  const hash = encodeShareState(state);
  const bytes = utf8Bytes(`${baseUrl}#${hash}`);
  if (bytes > MAX_SHARE_URL_BYTES) return { hash: null, tooLarge: true, bytes };
  const unchanged = currentHash.replace(/^#/, "") === hash;
  return { hash: unchanged ? null : hash, tooLarge: false, bytes };
}

// ------------------------------------------------------- store <-> link

/**
 * The store fields the address bar is a mirror of. Structural on purpose: the
 * hook hands it the Zustand state, a test hands it an object literal, and
 * neither this module nor the test needs to know the rest of the store exists.
 */
export interface ShareStoreSlice {
  view: MapView;
  selection: readonly string[];
  /**
   * Who selected each id, as the store recorded it. In the mirror for one
   * reason: `get_share_link` writes the `su` key from this record, and until
   * the bar wrote it too, a map whose owner proved they selected everything on
   * it lost that proof the moment the bar was rewritten — the recipient's page
   * re-encoded without `su`, and a `su`-less selection reads as the agent's
   * (`restoredAgentStateOf`). A proven-human map flipped to presumed-agent on
   * reload. See `userSelectedIds` in `map-tools/share.ts` for the three-part
   * contract this is part one of.
   */
  selectionSources: Readonly<Record<string, SelectionSource>>;
  drawings: readonly Drawing[];
  annotations: readonly Annotation[];
  tier2Loaded: readonly Tier2Category[];
  tier2Pending: readonly Tier2Category[];
  /**
   * Categories a restore gave up on, each one saying whether it is coming back.
   * Part of the link, not only of the notice on screen: a transient failure
   * still belongs in the bar (see `shareCategories`).
   */
  tier2RestoreFailures: readonly Tier2RestoreFailure[];
}

/**
 * The map as a link would carry it.
 *
 * `categories` is what is loaded **plus** what is still loading **plus** what
 * failed for a reason that may not hold next time, which is the whole reason
 * `shareCategories` exists (see its doc in `store/tier2.ts`): the mirror
 * rewrites the address bar 300 ms after a link is applied, long before a
 * half-megabyte category file has arrived, and a bar written from `tier2Loaded`
 * alone would hand the recipient a link to a map without the categories the
 * sender declared - and without the selection that depends on them. A category
 * that failed on a 5xx or a dropped connection stays declared for the same
 * reason one step later: the next page to open the link asks for the file
 * again. Only a permanent failure - a 4xx, or a category this build's index
 * does not list - drops out, because no page downstream can load it either. The
 * same union is what `get_share_link` hands out, so the bar and the tool cannot
 * disagree about what this map is.
 */
export function shareStateOf(state: ShareStoreSlice): ShareState {
  return {
    view: state.view,
    selection: state.selection,
    // Part two of the same contract: the bar carries the human's own ids, so a
    // link copied out of the address bar says exactly what `get_share_link`
    // would have said. `encodeShareState` intersects it with the selection and
    // omits it when empty, so an agent-only map still encodes to the bytes it
    // always did.
    userSelected: userSelectedIds(state.selection, state.selectionSources),
    drawings: state.drawings,
    annotations: state.annotations,
    categories: shareCategories(state.tier2Loaded, state.tier2Pending, state.tier2RestoreFailures),
  };
}

/**
 * Whether anything a link carries has changed. Reference equality, because each
 * of these is replaced wholesale by the store rather than mutated, and this
 * runs on every store write there is.
 *
 * The three tier-2 lists are here for the same reason they are in
 * `shareStateOf`: starting to load a category, and finishing or failing to load
 * one, both change what the link says while the camera and the selection stand
 * still. Without them the bar keeps whatever version it last wrote.
 *
 * The failures buy no wake-up the bar would otherwise miss today: every store
 * write that records or clears one sits next to a write of `tier2Pending` or
 * inside the same write as `tier2Loaded` (`restoreCategories` and
 * `addLoadedCategory`, via the backing in `store/map-store.ts`), and the debounce
 * coalesces the pair into one encode. They are listed because they are an input
 * of `shareStateOf`, and a guard that watches only some of what the link encodes
 * is one refactor away from a bar that silently stops following the map.
 */
export function shareStateChanged(state: ShareStoreSlice, previous: ShareStoreSlice): boolean {
  return (
    state.view !== previous.view ||
    state.selection !== previous.selection ||
    // Written in the same store call as `selection` today, so it buys no
    // wake-up of its own — and listed for the same reason the failures are: it
    // is an input of `shareStateOf`, and a guard that watches only some of what
    // the link encodes is one refactor away from a bar that stops following.
    state.selectionSources !== previous.selectionSources ||
    state.drawings !== previous.drawings ||
    state.annotations !== previous.annotations ||
    state.tier2Loaded !== previous.tier2Loaded ||
    state.tier2Pending !== previous.tier2Pending ||
    state.tier2RestoreFailures !== previous.tier2RestoreFailures
  );
}

/** What a link is restored into: the store's own writers, narrowed to these. */
export interface ShareRestoreTarget {
  setView(view: MapView): void;
  setSelection(ids: string[], attribution?: SelectionAttribution): void;
  addDrawing(drawing: ShareDrawing): void;
  addAnnotation(annotation: ShareAnnotation): void;
  /** `MapStore.restoreTier2Categories`; the result is deliberately not awaited. */
  restoreTier2Categories(categories: readonly Tier2Category[]): Promise<unknown>;
  /** Whether the link carried agent work; decides which chrome the page wears. */
  setRestoredAgentState(restoredAgentState: boolean): void;
  /** Whether the link *stated* who selected its ids; decides what that chrome may say. */
  setSelectionAttributionExplicit(selectionAttributionExplicit: boolean): void;
}

/** Applied, or refused with the codec's own sentence for the caller to log. */
export type ShareApplyResult = { ok: true } | { ok: false; error: string };

/**
 * Restore the map from a link. `setView`/`setSelection` replace, `addDrawing`/
 * `addAnnotation` append and mint the ids the wire format deliberately does not
 * carry - which is exactly the shape `decodeShareState` returns.
 *
 * Free of the browser, so the ordering below is a testable fact rather than
 * something only a real page can show.
 */
export function applyShareHash(hash: string, store: ShareRestoreTarget): ShareApplyResult {
  const decoded = decodeShareState(hash);
  if ("error" in decoded) return { ok: false, error: decoded.error };
  // Flag first, content second, and the order is load-bearing twice over
  // (`src/lib/awaken/index.ts` argues it in full). A restored map must never be
  // shown in human chrome: written last, the camera and the shapes would land
  // while the page still reported "idle" and the agent chrome would snap in
  // behind them. And no restore write may ever look like an agent *arriving* —
  // the only write in this sequence that can flip the mode is this one, and it
  // carries the bit that says "this is history, not news".
  store.setRestoredAgentState(restoredAgentStateOf(decoded));
  // Its sibling: decode-time evidence for what the restored chrome may *say*.
  // The surfaces that ask (the card's provenance line, the lane's SELECTED tag)
  // render long after the link is gone and cannot re-read it.
  store.setSelectionAttributionExplicit(selectionAttributionExplicit(decoded));
  store.setView(decoded.view);
  // Part three: the link's `su` ids go in as the human's, so this page holds
  // the provenance its own mirror will re-encode. Stated per id and wholesale —
  // a restore replaces the map, so what the link says about these ids replaces
  // whatever this page thought about the ones it used to hold.
  store.setSelection(decoded.selection, restoredSelectionSources(decoded));
  // Started, never awaited, and started here - before the drawings, before this
  // function returns, before anything else on the page can read the store.
  // `restoreCategories` marks the categories pending synchronously (see its doc
  // in `store/tier2.ts`), and that flag is what keeps the mirror above and
  // `select_features` from treating the link's not-yet-fetched ids as dead
  // during the seconds it takes the files to arrive. Awaiting instead would
  // hold the camera and the shapes hostage to a 2.5 MB download: the map is
  // restored now, and the POIs land when they land.
  if (decoded.categories.length) void store.restoreTier2Categories(decoded.categories);
  for (const drawing of decoded.drawings) store.addDrawing(drawing);
  for (const annotation of decoded.annotations) store.addAnnotation(annotation);
  return { ok: true };
}
