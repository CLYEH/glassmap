"use client";

import { SHARE_TOO_LARGE_MESSAGE } from "./share-hash";
import { useShareHash } from "./useShareHash";

/**
 * Runs the URL-hash mirror and reports the one thing about it a human needs to
 * be told: that the address bar has stopped keeping up. Everything else it does
 * is already visible in `state-overlay` (the camera, the counts) or in the
 * address bar itself.
 *
 * The element is always in the DOM, empty when there is nothing to say, so a
 * test can assert "nothing is wrong" without proving a negative.
 */
export function ShareStatus() {
  const { tooLarge } = useShareHash();
  return (
    <span
      data-testid="share-status"
      role="status"
      className={`absolute bottom-8 left-2 z-10 font-mono text-xs ${
        tooLarge ? "rounded bg-amber-400/95 px-2 py-1 text-zinc-900 shadow" : ""
      }`}
    >
      {tooLarge ? SHARE_TOO_LARGE_MESSAGE : ""}
    </span>
  );
}
