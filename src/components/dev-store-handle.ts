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
     * Dev/QA handle on Places browsing. The panel that will drive it is a
     * later task; until it exists this is the only way to reach the browse
     * layer, and it is the same handle the panel will call:
     * `__glassmapBrowse.getState().browse("cafe")` / `.clear()`.
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
 * The browse store rides the same handle for the same reason, one step
 * earlier: the Places panel is a later task, so today nothing in the UI can
 * turn the browse layer on.
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
