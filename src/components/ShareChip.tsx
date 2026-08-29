"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = {
  idle: "Share",
  copied: "Copied",
  failed: "Press ⌘C",
};

/** How long the chip keeps saying what happened before going back to "Share". */
const RESET_MS = 2000;

/**
 * Copies the address bar, which `useShareHash` has already filled with the
 * whole map state. The answer is the chip's own label — never a dialog:
 * `alert`/`confirm`/`prompt` freeze the page, and a frozen page is a frozen
 * agent.
 *
 * If the clipboard is refused (an insecure origin, or a browser that wants a
 * user gesture we did not give it), the chip says so and the URL is still in
 * the address bar to copy by hand. Nothing is thrown away.
 */
export function ShareChip() {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const announce = (next: CopyState) => {
    setState(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  };

  const onClick = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      announce("failed");
      return;
    }
    clipboard.writeText(window.location.href).then(
      () => announce("copied"),
      () => announce("failed"),
    );
  };

  return (
    <button
      type="button"
      className="share-chip"
      data-testid="share-chip"
      data-state={state}
      title="Copy a link that reproduces this exact map"
      aria-label={state === "idle" ? "Copy a link to this map" : LABEL[state]}
      onClick={onClick}
    >
      {state === "copied" ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.6 6.3 4.9 8.6 9.4 3.6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M4.8 7.2 7.2 4.8M5 3.4l1-1a2 2 0 0 1 2.8 2.8l-1 1M7 8.6l-1 1a2 2 0 0 1-2.8-2.8l1-1"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{LABEL[state]}</span>
    </button>
  );
}
