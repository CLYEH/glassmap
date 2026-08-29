"use client";

import { SHARE_TOO_LARGE_MESSAGE } from "./share-hash";
import { useShareHash } from "./useShareHash";

/**
 * Runs the URL-hash mirror and reports the one thing about it a human needs to
 * be told: that the address bar has stopped keeping up. Everything else it does
 * is already visible in the chrome (the camera chip, the inspector's counts) or
 * in the address bar itself.
 *
 * An amber chip above the corner stack, never a dialog: it sits where the
 * Share chip's answer would matter, and nothing about it blocks the agent.
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
      className={tooLarge ? "share-warning" : "gm-machine"}
    >
      {tooLarge ? SHARE_TOO_LARGE_MESSAGE : ""}
    </span>
  );
}
