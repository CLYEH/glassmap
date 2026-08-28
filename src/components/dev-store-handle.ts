"use client";

import { useEffect } from "react";
import { useMapStore } from "@/lib/store/map-store";

declare global {
  interface Window {
    /**
     * Dev/QA handle on the map store, alongside `window.__glassmap` (tools) and
     * `window.__glassmapMap` (the live map). Not set in production builds.
     */
    __glassmapStore?: typeof useMapStore;
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
 */
export function useDevStoreHandle() {
  useEffect(() => {
    if (!isDev) return;
    window.__glassmapStore = useMapStore;
    return () => {
      delete window.__glassmapStore;
    };
  }, []);
}
