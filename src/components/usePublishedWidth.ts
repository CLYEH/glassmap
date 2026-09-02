"use client";

import { useEffect, type RefObject } from "react";

/**
 * Publishes an element's own width as a CSS custom property on the document
 * root, so a *sibling* surface can be laid out against it in plain CSS.
 *
 * There is exactly one thing on this page that needs it, and it is a
 * collision: the Places dock is a centred island over the bottom bar
 * (`.dock`), and the loaded-POI disclosure grows leftward-to-rightward in the
 * same band (`.poi-strip`). Nothing in CSS can express "stop before the dock",
 * because the dock's width is *content* — the pill plus nought to three
 * browsed-category chips, each named — so it ranges from 159px to about 720px
 * and moves again whenever a person adds or drops a kind of place. A constant
 * that cleared the widest dock would starve the strip on the common
 * landing-width map; a constant that fitted the narrowest would put the strip
 * back under the chips. The browser is the only party that knows the number,
 * so we ask it, and hand the answer to the stylesheet.
 *
 * Deliberately a CSS variable rather than React state: this value changes on
 * every resize frame, and a `setState` per frame would re-render the dock, the
 * tray and the map chrome to move a box that CSS can move on its own. Nothing
 * re-renders here — the effect writes a property and the style engine does the
 * rest — which is also why it is safe under React 19's "no synchronous
 * setState in an effect" rule.
 *
 * The property is removed on unmount so a page that has no dock (there is
 * none today, but the fallback must be honest) falls back to the value written
 * in the stylesheet rather than to a stale measurement.
 */
export function usePublishedWidth(ref: RefObject<HTMLElement | null>, property: string): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = document.documentElement;
    // `getBoundingClientRect` rather than the observer's own `contentRect`:
    // the box that matters is the one on screen, borders and padding
    // included, and `contentRect` is the content box.
    const publish = () => {
      root.style.setProperty(property, `${Math.ceil(node.getBoundingClientRect().width)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [ref, property]);
}
