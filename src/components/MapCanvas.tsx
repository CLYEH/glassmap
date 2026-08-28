"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FEATURE_CATEGORIES, type GlassMapFeature } from "@/lib/data/schema";
import { useMapStore, type MapView } from "@/lib/store/map-store";
import {
  INTERACTIVE_LAYER_IDS,
  STYLE_URL,
  buildLayerSpecs,
  paintOf,
  sourceId,
} from "./map-style";

declare global {
  interface Window {
    /** Dev/QA handle on the live map. Not set in production builds. */
    __glassmapMap?: MapLibreMap;
  }
}

const isDev = process.env.NODE_ENV !== "production";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

/**
 * MapLibre 6 loads its tile worker from a file next to its own module, using
 * `new URL(name, import.meta.url)`. Turbopack bundles maplibre-gl into a chunk,
 * so that URL does not exist and the worker silently never starts: the style
 * loads, no tile is ever requested and `map.on("load")` never fires.
 * We therefore serve the worker (and the shared chunk it imports as a sibling)
 * from `public/maplibre/`. `src/components/maplibre-worker-asset.test.ts` fails
 * if those copies drift from the installed version.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * MapLibre needs WebGL2 and reports its absence by firing `error` from inside
 * the constructor, before we can attach a listener, leaving a Map whose camera
 * methods throw. Checking first keeps that broken object from ever existing.
 */
function hasWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Push the store's feature list into the per-category GeoJSON sources. */
function applyFeatures(map: MapLibreMap, features: readonly GlassMapFeature[]) {
  for (const category of FEATURE_CATEGORIES) {
    const source = map.getSource(sourceId(category)) as GeoJSONSource | undefined;
    if (!source) continue;
    source.setData({
      type: "FeatureCollection",
      features: features.filter((f) => f.properties?.category === category),
    });
  }
}

type PaintPropertyName = Parameters<MapLibreMap["setPaintProperty"]>[1];
type PaintPropertyValue = Parameters<MapLibreMap["setPaintProperty"]>[2];

/** Re-evaluate every selection-dependent paint property. */
function applySelection(map: MapLibreMap, selection: readonly string[]) {
  for (const layer of buildLayerSpecs(selection)) {
    if (!map.getLayer(layer.id)) continue;
    for (const [prop, value] of Object.entries(paintOf(layer))) {
      map.setPaintProperty(layer.id, prop as PaintPropertyName, value as PaintPropertyValue);
    }
  }
}

/** Move the camera to a store view, unless the map is already there. */
function applyView(map: MapLibreMap, view: MapView) {
  const center = map.getCenter();
  const settled =
    Math.abs(center.lng - view.center[0]) < 1e-6 &&
    Math.abs(center.lat - view.center[1]) < 1e-6 &&
    Math.abs(map.getZoom() - view.zoom) < 1e-4 &&
    Math.abs(map.getBearing() - view.bearing) < 1e-4 &&
    Math.abs(map.getPitch() - view.pitch) < 1e-4;
  if (settled) return;
  map.flyTo({
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch,
    essential: true,
  });
}

/**
 * The map is a mirror of the store: tools write `view`/`selection` and the map
 * follows; user gestures write back through `moveend`. `fromMap` marks the
 * write-backs so they are never re-applied to the camera.
 */
export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Written imperatively: React must not re-render this component.
    const setStatus = (value: string) => {
      if (statusRef.current) statusRef.current.textContent = value;
    };

    if (!hasWebGL2()) {
      // Headless CI or a blocked GPU: no map, but the store, the overlay and
      // every tool keep working.
      setStatus("unavailable");
      return;
    }

    const store = useMapStore;
    const initial = store.getState().view;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: STYLE_URL,
        center: initial.center,
        zoom: initial.zoom,
        bearing: initial.bearing,
        pitch: initial.pitch,
        attributionControl: { compact: true },
      });
    } catch (error) {
      // No WebGL (headless CI, blocked GPU). Tools and the overlay keep working.
      setStatus("unavailable");
      if (isDev) console.warn("[GlassMap] MapLibre could not start:", error);
      return;
    }

    if (isDev) window.__glassmapMap = map;

    let ready = false;
    let fromMap = false;

    const pushViewFromMap = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      fromMap = true;
      try {
        store.getState().setView({
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
        store
          .getState()
          .setBounds([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
      } finally {
        fromMap = false;
      }
    };

    // Tile and glyph failures are reported here; keep them out of the console
    // in production but never let them reach the user as a dialog.
    map.on("error", (event) => {
      if (isDev) console.warn("[GlassMap] map error:", event.error?.message ?? event);
    });

    map.on("load", () => {
      for (const category of FEATURE_CATEGORIES) {
        map.addSource(sourceId(category), { type: "geojson", data: EMPTY });
      }
      const { features, selection } = store.getState();
      for (const layer of buildLayerSpecs(selection)) map.addLayer(layer);
      applyFeatures(map, features);

      const canvas = map.getCanvas();
      map.on("click", INTERACTIVE_LAYER_IDS, (event) => {
        const id = event.features
          ?.map((f) => f.properties?.id)
          .find((value): value is string => typeof value === "string");
        if (!id) return;
        const current = store.getState().selection;
        store
          .getState()
          .setSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
      });
      map.on("mouseenter", INTERACTIVE_LAYER_IDS, () => {
        canvas.style.cursor = "pointer";
      });
      map.on("mouseleave", INTERACTIVE_LAYER_IDS, () => {
        canvas.style.cursor = "";
      });

      ready = true;
      setStatus("ready");
      pushViewFromMap();
    });

    map.on("moveend", pushViewFromMap);

    const unsubscribe = store.subscribe((state, previous) => {
      if (state.view !== previous.view && !fromMap) applyView(map, state.view);
      if (!ready) return;
      if (state.features !== previous.features) applyFeatures(map, state.features);
      if (state.selection !== previous.selection) applySelection(map, state.selection);
    });

    return () => {
      unsubscribe();
      try {
        map.remove();
      } catch {
        // A map that never got a GPU context throws here; letting it escape the
        // effect cleanup would unmount the whole page.
      }
      if (isDev) delete window.__glassmapMap;
    };
  }, []);

  return (
    <>
      {/* The wrapper carries the positioning: maplibre-gl.css is unlayered, so
          its `.maplibregl-map { position: relative }` beats Tailwind's layered
          `.absolute` on the container itself. The absolute wrapper also gives
          the container a definite height for `h-full` to resolve against. */}
      <div className="absolute inset-0">
        <div ref={containerRef} data-testid="map" className="h-full w-full" />
      </div>
      <span
        ref={statusRef}
        data-testid="map-status"
        className="absolute bottom-2 left-2 z-10 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white"
      >
        loading
      </span>
    </>
  );
}
