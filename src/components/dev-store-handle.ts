"use client";

import { useEffect } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { useBrowseStore } from "./browse-store";

declare global {
  interface Window {
    /**
     * Dev/QA handle on the map store, alongside `window.__glassmap` (tools) and
     * `window.__glassmapMap` (the live map). Not set in production builds.
     */
    __glassmapStore?: typeof useMapStore;
    /**
     * Dev/QA handle on Places browsing — the same store `PlacesDock` drives,
     * so a run can put a category on the map without hunting for a chip in a
     * tray it would first have to open:
     * `__glassmapBrowse.getState().browse("cafe")`, `.remove("cafe")`,
     * `.clear()`.
     */
    __glassmapBrowse?: typeof useBrowseStore;
  }
}

const isDev = process.env.NODE_ENV !== "production";

/**
 * Exposes the store to the browser console and to Playwright.
 *
 * Drawings and annotations are visible effects with no UI that can create an
 * *agent-made* one, so without this the only way to check that a tool's shape
 * renders would be to run the tool layer. QA drives
 * `__glassmapStore.getState().addDrawing(...)` instead.
 *
 * The browse store rides the same handle for a nearby reason: the Places tray
 * can turn the browse layer on, but only through a tray a run has to open and
 * a chip whose position depends on how many kinds are painted — so a check
 * about what the layer *draws* says what it means by calling the store the
 * tray calls.
 */
export function useDevStoreHandle() {
  useEffect(() => {
    if (!isDev) return;
    window.__glassmapStore = useMapStore;
    window.__glassmapBrowse = useBrowseStore;
    return () => {
      delete window.__glassmapStore;
      delete window.__glassmapBrowse;
    };
  }, []);
}
