import {
  MAX_SHARE_URL_BYTES,
  encodeShareState,
  utf8Bytes,
  type ShareState,
} from "@/lib/map-tools/share";

/**
 * How long the map has to stand still before its state goes into the address
 * bar. A pan is a stream of `moveend`s and a drawn polygon is a stream of
 * `addDrawing`s; encoding on each one would burn a base64 pass per frame and
 * still end up writing the same final string.
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
