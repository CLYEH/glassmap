"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A CSS media query as React state, through `useSyncExternalStore` so the
 * subscription is never a `setState` inside an effect.
 *
 * The server snapshot is always `false`: the first HTML is rendered without a
 * window, so every query answers "no" there and the real answer arrives on
 * hydration. Layout itself is done in CSS — this hook is only for the few
 * places where a *behaviour* differs by tier (which sheet tab is showing, and
 * whether a busy feed starts collapsed).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below this width the inspector is a bottom sheet; see globals.css. */
export const SHEET_TIER = "(max-width: 920px)";

/** The mid tier, where a busy feed starts collapsed so the map stays readable. */
export const MID_TIER = "(min-width: 921px) and (max-width: 1240px)";
