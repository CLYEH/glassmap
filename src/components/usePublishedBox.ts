"use client";

import { useEffect, type RefObject } from "react";

/**
 * Publishes an element's own box as CSS custom properties on the document
 * root, so a *sibling* surface can be laid out against it in plain CSS.
 *
 * There is exactly one thing on this page that needs it, and it is a
 * collision. The Places dock is an island over the bottom bar (`.dock`,
 * absolute, out of the flow), and everything the bar carries shares that band:
 * the loaded-POI disclosure on the left, the licence attribution, the badge
 * and the corner whisper on the right. Nothing in CSS can express "stop before
 * the dock" or "sit above it", because the dock's box is *content* — the pill
 * alone is 160x39, the pill plus three named browsed chips is up to 815x177,
 * and a person changes which of the two it is with one tap. A constant that
 * cleared the largest would ruin the landing map; a constant that fitted the
 * smallest would put the licence back under the chips. The browser is the only
 * party that knows the number, so we ask it, and hand the answer to the
 * stylesheet.
 *
 * Deliberately custom properties rather than React state: these values change
 * on every resize frame, and a `setState` per frame would re-render the dock,
 * the tray and the map chrome to move boxes that CSS can move on its own.
 * Nothing re-renders here — the effect writes two properties and the style
 * engine does the rest — which is also why it is safe under React 19's "no
 * synchronous setState in an effect" rule.
 *
 * ## It runs during a window resize, so it costs as little as possible there
 *
 * The map resizes its canvas and republishes `bounds` on the same `resize`
 * this observer fires on, and `e2e/awakening-flight.spec.ts` reads `bounds`
 * with no wait after `setViewportSize` — so anything this hook adds to that
 * frame is added to a race. Two rules keep it cheap:
 *
 *  - The size comes from the entry the observer already delivers
 *    (`borderBoxSize`), which is measured, not queried. Calling
 *    `getBoundingClientRect()` here instead would force a synchronous reflow
 *    ahead of the map's own resize work, for a number the observer is already
 *    holding.
 *  - The properties are written only when the number actually moves. A custom
 *    property on the root invalidates style for the whole document; the dock
 *    is content-sized, so a window resize usually does not change it at all,
 *    and re-asserting the same 160px would spend a full recalc to change
 *    nothing.
 *
 * The first callback is delivered as soon as the element is observed, so
 * there is no separate initial read either.
 *
 * The properties are removed on unmount, so a page with no dock falls back to
 * the values written in the stylesheet rather than to a stale measurement.
 */
export function usePublishedBox(ref: RefObject<HTMLElement | null>, prefix: string): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = document.documentElement;
    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize[0];
      // Rounded up, because every consumer of these is clearing the box, not
      // filling it.
      const width = Math.ceil(box.inlineSize);
      const height = Math.ceil(box.blockSize);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      root.style.setProperty(`${prefix}-w`, `${width}px`);
      root.style.setProperty(`${prefix}-h`, `${height}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(`${prefix}-w`);
      root.style.removeProperty(`${prefix}-h`);
    };
  }, [ref, prefix]);
}
