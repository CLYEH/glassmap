"use client";

import { useEffect, useState } from "react";
import { decodeShareState } from "@/lib/map-tools/share";
import { useMapStore } from "@/lib/store/map-store";
import { SHARE_WRITE_DEBOUNCE_MS, planHashUpdate } from "./share-hash";

const isDev = process.env.NODE_ENV !== "production";

/**
 * A link is applied at most once per page load, and this is deliberately module
 * state rather than a ref: the drawings a link carries are added to the store,
 * and the store outlives this component. A hook that re-applied on remount
 * would hand the map a second copy of every shape it already has.
 */
let applied = false;

/**
 * Restore the map from a link. `setView`/`setSelection` replace, `addDrawing`/
 * `addAnnotation` append and mint the ids the wire format deliberately does not
 * carry — which is exactly the shape `decodeShareState` returns.
 */
function applyShareHash(hash: string): void {
  const decoded = decodeShareState(hash);
  if ("error" in decoded) {
    // Whatever is after the "#" is not ours to police: it may be an anchor, a
    // paste that lost its tail, or a link from a build that knows more than
    // this one. The map opens on its default view and the page carries on.
    if (isDev) console.warn(`[GlassMap] ignoring share link: ${decoded.error}`);
    return;
  }
  const store = useMapStore.getState();
  store.setView(decoded.view);
  store.setSelection(decoded.selection);
  for (const drawing of decoded.drawings) store.addDrawing(drawing);
  for (const annotation of decoded.annotations) store.addAnnotation(annotation);
}

/**
 * The address bar as a mirror of the store, in both directions.
 *
 * Opening a link restores the map through the store rather than through the
 * map: the store is what tools read, and it is populated before MapCanvas is
 * even loaded (it is a `next/dynamic` import), so the map opens *at* the shared
 * camera instead of flying to it. Should that ordering ever change, the map's
 * own store subscription flies it there instead — either way the link lands.
 *
 * Writing back is debounced and goes through `history.replaceState`, never
 * `location.hash = …`: assigning to `location.hash` pushes a history entry and
 * fires `hashchange`, so a panned map would both fill the back button and
 * re-enter this module through its own output.
 *
 * Nothing listens for `hashchange` either. A link is applied when the page
 * loads it; editing the fragment of a page that is already open is not a way
 * anyone shares a map, and listening would mean every write we make is an
 * event we have to recognise as our own.
 *
 * @returns whether the map has outgrown a URL, for `ShareStatus` to say so.
 */
export function useShareHash(): { tooLarge: boolean } {
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    const store = useMapStore;
    let applying = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const write = () => {
      timer = null;
      const { view, selection, drawings, annotations } = store.getState();
      const plan = planHashUpdate(
        { view, selection, drawings, annotations },
        // Everything before the "#": the query survives, so `?shim=1` is still
        // there after a pan, and it counts against the byte budget because it
        // is part of the URL someone would copy.
        window.location.href.split("#")[0],
        window.location.hash,
      );
      setTooLarge(plan.tooLarge);
      if (plan.hash === null) return;
      try {
        // A bare fragment resolves against the current URL, so this replaces
        // the hash and nothing else.
        window.history.replaceState(null, "", `#${plan.hash}`);
      } catch (error) {
        // WebKit throttles history writes (SecurityError past ~100 in 30 s).
        // The debounce keeps us under that, but a page left panning for half an
        // hour is exactly the case that finds the edge, and an address bar that
        // stopped updating is not worth taking the map down for. The next
        // change tries again.
        if (isDev) console.warn("[GlassMap] could not update the share link:", error);
      }
    };

    const schedule = () => {
      if (applying) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, SHARE_WRITE_DEBOUNCE_MS);
    };

    const unsubscribe = store.subscribe((state, previous) => {
      if (
        state.view !== previous.view ||
        state.selection !== previous.selection ||
        state.drawings !== previous.drawings ||
        state.annotations !== previous.annotations
      ) {
        schedule();
      }
    });

    // Subscribed first so this ordering is not load-bearing; `applying` is what
    // keeps restoring a link from scheduling a write of what it just restored.
    if (!applied && window.location.hash.replace(/^#/, "")) {
      applied = true;
      applying = true;
      try {
        applyShareHash(window.location.hash);
      } finally {
        applying = false;
      }
    }

    // Once, whatever happened above. Without it the address bar is only ever
    // written when something else moves the store, so a page opened with no
    // hash (or with WebGL unavailable, where no map reports a camera back)
    // never gets a link at all, and a partially-rejected pasted link stays in
    // the bar unchanged - re-shared verbatim, still promising the shapes this
    // build just dropped. `planHashUpdate` answers "no change" when there is
    // none, so this costs one encode per load and usually writes nothing.
    schedule();

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return { tooLarge };
}
