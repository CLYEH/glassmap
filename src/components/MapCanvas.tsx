"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { bootMode } from "@/lib/awaken";
import { FEATURE_CATEGORIES, type GlassMapFeature } from "@/lib/data/schema";
import type { MapFeature } from "@/lib/store/tier2";
import {
  useMapStore,
  type Annotation,
  type Drawing,
  type LngLat,
  type MapView,
} from "@/lib/store/map-store";
import { createAnnotationElement } from "./annotation-marker";
import { createBeadImages } from "./bead-sprite";
import { useCardStore } from "./card-store";
import {
  BEAD_LAYER_IDS,
  BEAD_SOURCE,
  BROWSE_BEAD_LAYER,
  BROWSE_GRAIN_LAYER,
  BROWSE_SOURCE,
  beadAnchorsToGeoJson,
  beadSourceSpec,
  browseBeadFilter,
  browseGrainFilter,
  browsePointsToGeoJson,
  browseSourceSpec,
  browseTierMinimum,
  buildBeadLayerSpecs,
  countedClusterThreshold,
  selectionProvenance,
} from "./bead-style";
import { useBrowseStore } from "./browse-store";
import { useDrawStore, type DrawMode } from "./draw-store";
import { setFxMap } from "./fx/map-handle";
import {
  DRAFT_SOURCE,
  DRAWING_LABEL_SOURCE,
  DRAWING_LAYER_IDS,
  DRAWING_SOURCE,
  buildDrawingLayerSpecs,
  draftToGeoJson,
  drawingsToGeoJson,
  labelPointsToGeoJson,
} from "./drawing-style";
import {
  INTERACTIVE_LAYER_IDS,
  SELECTION_SOURCE,
  STYLE_URL,
  buildLayerSpecs,
  categorySourceSpec,
  featureSourceIndex,
  selectedPoiFeatures,
  selectionAnchorsToGeoJson,
  sourceId,
  syncSelectionState,
} from "./map-style";
import { approximateBounds, visibleBounds } from "./viewport-bounds";

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

/**
 * The lane the inspector covers, in CSS pixels, read from the same custom
 * property the stylesheet lays the inspector out with — so the map's padding
 * and the chrome can never disagree about where the visible corridor is. Zero
 * below 921px, where the inspector is a bottom sheet and the map container is
 * shortened instead of overlaid.
 *
 * Zero in human chrome as well, and for the plainest possible reason: there is
 * no inspector there (`page.tsx` mounts it only once an agent is here), so the
 * whole canvas is the corridor. Read from the store rather than from the DOM
 * because it is the store's answer the chrome is rendered from — the same
 * `bootMode` the page and the awakening use — and a padding measured off a
 * class name would be one render behind whichever of the two moved first.
 *
 * This is the single source of truth for the corridor: `applyPadding` puts the
 * camera centre in it and `pushViewFromMap` publishes its edges as `bounds`,
 * so the two can never describe different rectangles. It does not follow the
 * Hide button, because hiding only empties the panel's body — the glass sheet
 * still covers the lane, so the map under it is still not visible.
 */
function inspectorLane(): number {
  if (bootMode(useMapStore.getState()) === "idle") return 0;
  if (window.matchMedia("(max-width: 920px)").matches) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--lane");
  return Number.parseFloat(value) || 0;
}

/** Push a GeoJSON source, ignoring the window before `load` when it does not exist yet. */
function setSourceData(map: MapLibreMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function applyDrawings(map: MapLibreMap, drawings: readonly Drawing[]) {
  setSourceData(map, DRAWING_SOURCE, drawingsToGeoJson(drawings));
  setSourceData(map, DRAWING_LABEL_SOURCE, labelPointsToGeoJson(drawings));
}

const applyDraft = (map: MapLibreMap, draft: readonly LngLat[]) =>
  setSourceData(map, DRAFT_SOURCE, draftToGeoJson(draft));

/**
 * Add/remove one marker per annotation, keeping the ones that did not change.
 * Rebuilding all of them on every store write would close a bubble the user is
 * reading whenever an agent pins another note.
 */
function syncAnnotationMarkers(
  map: MapLibreMap,
  markers: Map<string, Marker>,
  annotations: readonly Annotation[],
  onTap: (id: string) => void,
) {
  const live = new Set(annotations.map((a) => a.id));
  for (const [id, marker] of markers) {
    if (live.has(id)) continue;
    marker.remove();
    markers.delete(id);
  }
  for (const annotation of annotations) {
    if (markers.has(annotation.id)) continue;
    const marker = new Marker({
      element: createAnnotationElement(annotation, onTap),
      anchor: "bottom",
    })
      .setLngLat(annotation.at)
      .addTo(map);
    markers.set(annotation.id, marker);
  }
}

/**
 * How close a click has to be to the previous vertex to count as the same one.
 * The second click of a double-click lands a pixel or two off the first, and it
 * must not leave a duplicate corner behind when the polygon is finished.
 */
const VERTEX_SLOP_PX = 8;

const sameView = (a: MapView, b: MapView) =>
  Math.abs(a.center[0] - b.center[0]) < 1e-6 &&
  Math.abs(a.center[1] - b.center[1]) < 1e-6 &&
  Math.abs(a.zoom - b.zoom) < 1e-4 &&
  Math.abs(a.bearing - b.bearing) < 1e-4 &&
  Math.abs(a.pitch - b.pitch) < 1e-4;

/**
 * The map is a mirror of the store: tools write `view`/`selection` and the map
 * follows; user gestures write back through `moveend`.
 *
 * Two guards keep the two directions from chasing each other:
 *  - `fromMap` - set while the map writes the store, so the store subscriber
 *    does not re-command the camera with the position it just reported.
 *  - `toMap` - set while we command the camera. `flyTo` begins with `stop()`,
 *    which fires `moveend` SYNCHRONOUSLY when an animation is already running;
 *    without this guard that re-entrant `moveend` writes the mid-flight camera
 *    back over the request a tool is about to read.
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

    const store = useMapStore;
    const draw = useDrawStore;
    const browse = useBrowseStore;
    const card = useCardStore;

    /**
     * No map, so nothing will ever report a viewport. Compute one instead:
     * without it `bounds` stays null forever and every viewport tool answers
     * "map not ready" on a page whose store, overlay and tools all work.
     *
     * It is recomputed on both inputs it depends on - the camera (a tool moved
     * it) and the container size (the window was resized, which a real map
     * would have reported through `moveend`).
     */
    const startBoundsFallback = () => {
      const pushBounds = () => {
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        // The same corridor a live map publishes: the inspector's lane is not
        // part of what anyone can see, and `view.center` is the corridor's
        // centre, so the extent stays symmetric around it — just narrower.
        const corridor = Math.max(width - inspectorLane(), 0);
        store.getState().setBounds(approximateBounds(store.getState().view, corridor, height));
      };
      pushBounds();
      const unsubscribe = store.subscribe((state, previous) => {
        // The chrome flipping is a corridor change like any other: the
        // inspector lane appears with the agent, and the rectangle a tool is
        // told about has to shrink with it.
        if (state.view !== previous.view || bootMode(state) !== bootMode(previous)) pushBounds();
      });
      window.addEventListener("resize", pushBounds);
      return () => {
        window.removeEventListener("resize", pushBounds);
        unsubscribe();
      };
    };

    if (!hasWebGL2()) {
      // Headless CI or a blocked GPU: no map, but the store, the overlay and
      // every tool keep working.
      setStatus("unavailable");
      return startBoundsFallback();
    }

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
        // The licence attribution is rendered by <Attribution /> in the bottom
        // bar instead: the built-in control sits in the map's own bottom-right
        // corner, which the inspector covers on every desktop width.
        attributionControl: false,
      });
    } catch (error) {
      // No WebGL (headless CI, blocked GPU). Tools and the overlay keep working.
      setStatus("unavailable");
      if (isDev) console.warn("[GlassMap] MapLibre could not start:", error);
      return startBoundsFallback();
    }

    if (isDev) window.__glassmapMap = map;
    // The FX layer projects lng/lat through this map every frame. Published in
    // every build, not just dev: agent-presence effects are product, not
    // tooling. A page with no map leaves the slot null and the map-space
    // effects degrade to their feed-row glow.
    setFxMap(map);

    /** One MapLibre marker per annotation id, kept in step with the store. */
    const markers = new Map<string, Marker>();

    /**
     * A person's tap on a note: the third mark that answers the card, and the
     * one a human alone on this page is most likely to have made by hand.
     *
     * Anchored to the note's own coordinate rather than to the click, because
     * that is what the card is about — and because the pin is a tall element
     * whose top is nowhere near the place it points at. In draw mode a tap is
     * a vertex like any other, so the card stays out of the way.
     */
    const tapAnnotation = (id: string) => {
      if (draw.getState().mode !== "none") return;
      const annotation = store.getState().annotations.find((a) => a.id === id);
      if (!annotation) return;
      const at = map.project(annotation.at);
      card.getState().open({ kind: "annotation", id, x: at.x, y: at.y });
    };

    let ready = false;
    /**
     * True once the style JSON itself has arrived — NOT once the map is fully
     * loaded. It gates animation in `applyView`, because MapLibre only ever
     * schedules a render frame through `Map._update`, which begins with
     * `if (!this.style?._loaded) return this;`. With no style nothing drives
     * the render loop, so an eased camera never advances: `flyTo` queues its
     * ease callback on a render-task queue no frame ever runs, `movestart`
     * fires, `moveend` never does, and `map.getCenter()` stays at the
     * pre-flight position for the rest of the session.
     *
     * Deliberately not `map.isStyleLoaded()` (that also waits for tiles and
     * images, so a healthy map mid-tile-load would stop animating) and not
     * the "error" status (that is also set when the style loaded but its
     * tiles failed — a map whose render loop is perfectly alive).
     */
    let styleLoaded = false;
    let fromMap = false;
    let toMap = false;
    // The camera target we last commanded or observed. `applyView` compares a
    // request against THIS, never the live (possibly mid-flight) camera, so a
    // request is not dropped just because it momentarily matches an unrelated
    // interpolated position.
    let lastView: MapView = initial;

    /**
     * Publish the extent of the corridor the camera is currently over. Not
     * `map.getBounds()`: that spans the whole canvas, whose eastern
     * 300-336 px are behind the inspector. See `visibleBounds`.
     */
    const pushBoundsFromMap = () => {
      store
        .getState()
        .setBounds(
          visibleBounds(
            (point) => map.unproject(point),
            container.clientWidth,
            container.clientHeight,
            inspectorLane(),
          ),
        );
    };

    const pushViewFromMap = () => {
      // A `moveend` our own flyTo caused, not a user gesture - ignore it.
      if (toMap) return;
      const center = map.getCenter();
      const view: MapView = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
      lastView = view;
      fromMap = true;
      try {
        store.getState().setView(view);
        pushBoundsFromMap();
      } finally {
        fromMap = false;
      }
    };

    const applyView = (view: MapView) => {
      if (sameView(view, lastView)) return;
      lastView = view;
      const camera = {
        center: view.center,
        zoom: view.zoom,
        bearing: view.bearing,
        pitch: view.pitch,
      };
      toMap = true;
      try {
        // Animate only when there is a render loop to animate in. Without a
        // style (the basemap is unreachable - a state every tool is supposed
        // to keep working in) the flight would stall on its first frame and
        // never end, so the camera would sit at the old position while the
        // store reports the new one, and `bounds` - only ever written from
        // `moveend` - would freeze there with it. A jump has no animation to
        // stall: the map really is where the store says it is.
        if (styleLoaded) map.flyTo({ ...camera, essential: true });
        else map.jumpTo(camera);
      } finally {
        toMap = false;
      }
      // `jumpTo` fires its `moveend` synchronously, i.e. inside the `toMap`
      // guard above, whose whole job is to ignore re-entrant camera events -
      // so the corridor has to be published from here instead. The camera has
      // already arrived, so this is the very rectangle that `moveend` would
      // have reported. `view` is what the store already holds, so only
      // `bounds` needs to catch up.
      if (!styleLoaded) pushBoundsFromMap();
    };

    // The inspector floats over the map's east edge, so without padding the
    // camera centre a tool reads back would sit behind it. `setPadding` keeps
    // the centre coordinate and moves where it lands on screen, into the
    // corridor the human can actually see. Applied before the first
    // `pushViewFromMap` so the very first `center`/`bounds` pair a tool can
    // read already describes that corridor and not the full canvas.
    const applyPadding = () => {
      map.setPadding({ top: 0, bottom: 0, left: 0, right: inspectorLane() });
    };
    applyPadding();
    window.addEventListener("resize", applyPadding);

    // The transform is valid as soon as the constructor returns, so bounds is
    // available immediately - a tool must not see `bounds: null` for the ~1.4 s
    // until tiles arrive, and it must stay set even if the basemap never loads.
    pushViewFromMap();

    // Tile and glyph failures are reported here. A failure BEFORE the map is
    // ready means the basemap never came up: report it as a distinct "error"
    // so a dead basemap is not indistinguishable from a slow one. A later
    // successful `load` overwrites this back to "ready".
    map.on("error", (event) => {
      if (isDev) console.warn("[GlassMap] map error:", event.error?.message ?? event);
      if (!ready) setStatus("error");
    });

    // Fired the moment the style JSON is parsed, long before the tiles that
    // `load` waits for. From here on the render loop runs, so camera flights
    // complete and report themselves - see `styleLoaded`.
    map.on("style.load", () => {
      styleLoaded = true;
    });

    // --- Selection ---------------------------------------------------------
    // The selected look is a feature state, not a list of ids in the paint
    // expressions (see `sel` in map-style.ts). Both maps are id -> source id:
    // `featureSources` is every feature the store has loaded, `selectedFeatures`
    // is the subset currently flagged on the map.

    let featureSources = new Map<string, string>();
    let selectedFeatures = new Map<string, string>();

    /**
     * Move the map's feature state to `selection`. The diff itself lives in
     * `syncSelectionState` (map-style.ts), where it can be unit-tested without
     * a live map; this only binds it to the two MapLibre calls and keeps the
     * result.
     */
    const applySelectionState = (selection: readonly string[], reapply = false) => {
      selectedFeatures = syncSelectionState({
        selection,
        applied: selectedFeatures,
        featureSources,
        reapply,
        setFeatureState: (target, state) => map.setFeatureState(target, state),
        removeFeatureState: (target, key) => map.removeFeatureState(target, key),
      });
    };

    /**
     * New feature data, and the selection re-stated on top of it (`reapply`,
     * see `syncSelectionState`): a selected id whose category had not loaded
     * yet becomes markable only now.
     */
    const applyFeatureData = (
      features: readonly GlassMapFeature[],
      selection: readonly string[],
    ) => {
      applyFeatures(map, features);
      featureSources = featureSourceIndex(features);
      applySelectionState(selection, true);
    };

    /**
     * The two marks a selection makes: a bead per selected point of interest,
     * and a ring around every selected bundled feature.
     *
     * One call does both because the two are one statement — "these are the
     * ones I meant" — made in the only two ways this map has. Deselecting
     * empties both sources, which is how the calm map comes back: a category
     * stays in memory for the tools, and off the screen.
     */
    const applySelectionMarks = (
      tier2: readonly MapFeature[],
      features: readonly GlassMapFeature[],
      selection: readonly string[],
    ) => {
      const sources = selectionProvenance(store.getState());
      const poi = selectedPoiFeatures(tier2, selection);
      setSourceData(map, BEAD_SOURCE, beadAnchorsToGeoJson(poi, selection, sources));
      setSourceData(map, SELECTION_SOURCE, selectionAnchorsToGeoJson(features, selection, sources));
    };

    /**
     * The browse layer: one category, painted because a human asked to look
     * around in it. Selected places are left out — they are already beads, and
     * a place carrying both marks would be counted twice.
     */
    const applyBrowse = () => {
      const { tier2Features, selection } = store.getState();
      const category = browse.getState().category;
      setSourceData(map, BROWSE_SOURCE, browsePointsToGeoJson(tier2Features, category, selection));
    };

    /**
     * The ink budget, recomputed for the clusters actually on screen.
     *
     * The two browse layers' filters are complementary, so querying both gives
     * every browse feature in view whatever the current threshold is — the
     * measurement cannot chase its own result. Clusters are addressed by
     * `cluster_id` because one straddling a tile seam is returned twice.
     *
     * Queried over the corridor, not the canvas: "the twelve largest clusters
     * in view" has to mean the same rectangle `bounds` reports and the camera
     * is centred in, or the budget would be spent on clusters sitting under
     * the inspector's glass, where nobody can read a numeral.
     */
    let inkThreshold = Number.POSITIVE_INFINITY;
    const applyInkBudget = () => {
      if (!ready) return;
      const browsing = browse.getState().category !== null;
      let next = Number.POSITIVE_INFINITY;
      if (browsing) {
        const counts = new Map<number, number>();
        const container = map.getContainer();
        const corridor: [[number, number], [number, number]] = [
          [0, 0],
          [Math.max(container.clientWidth - inspectorLane(), 0), container.clientHeight],
        ];
        for (const feature of map.queryRenderedFeatures(corridor, {
          layers: [BROWSE_GRAIN_LAYER, BROWSE_BEAD_LAYER],
        })) {
          const { cluster_id: cluster, point_count: count } = feature.properties as {
            cluster_id?: number;
            point_count?: number;
          };
          if (typeof cluster === "number" && typeof count === "number") counts.set(cluster, count);
        }
        next = countedClusterThreshold(
          [...counts.values()],
          undefined,
          browseTierMinimum(map.getZoom()),
        );
      }
      // Guarded: setting the same filter would repaint, which fires `idle`,
      // which lands back here. Only a real change is allowed to close the loop.
      if (next === inkThreshold) return;
      inkThreshold = next;
      map.setFilter(BROWSE_GRAIN_LAYER, browseGrainFilter(next));
      map.setFilter(BROWSE_BEAD_LAYER, browseBeadFilter(next));
      browse.getState().setThreshold(next);
    };

    map.on("load", () => {
      for (const category of FEATURE_CATEGORIES) {
        map.addSource(sourceId(category), categorySourceSpec());
      }
      // The bead sprites have to exist before any layer names one, or MapLibre
      // draws the symbol's text with no icon under it.
      for (const { id, image, pixelRatio } of createBeadImages()) {
        if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio });
      }
      // All three start empty, and empty is their resting state: a bead means
      // somebody acted on that place, a ring means a selected bundled feature,
      // a browse grain means a human asked to look around.
      map.addSource(BEAD_SOURCE, beadSourceSpec());
      map.addSource(BROWSE_SOURCE, browseSourceSpec());
      map.addSource(SELECTION_SOURCE, { type: "geojson", data: EMPTY });
      const { features, selection, drawings, tier2Features } = store.getState();
      for (const layer of buildLayerSpecs()) map.addLayer(layer);
      for (const layer of buildBeadLayerSpecs()) map.addLayer(layer);
      applyFeatureData(features, selection);
      // Read from the store rather than started empty: a category can already
      // be loaded and selected by the time the style finishes (the tools work
      // before the basemap does, and a remount re-runs this whole effect).
      applySelectionMarks(tier2Features, features, selection);
      applyBrowse();

      // Drawings sit on top of the data layers: a shape is always about the
      // features under it.
      map.addSource(DRAWING_SOURCE, { type: "geojson", data: EMPTY });
      map.addSource(DRAWING_LABEL_SOURCE, { type: "geojson", data: EMPTY });
      map.addSource(DRAFT_SOURCE, { type: "geojson", data: EMPTY });
      for (const layer of buildDrawingLayerSpecs()) map.addLayer(layer);
      applyDrawings(map, drawings);
      applyDraft(map, draw.getState().draft);

      const canvas = map.getCanvas();
      /**
       * A person's tap on a place: it goes on the map, and it answers.
       *
       * The selection write carries `"user"` — the click is the human writer
       * `selectionSources` was built for (T-80), and it is what keeps a rose
       * bead rose, keeps `su` in the link this page writes back, and lets the
       * card say "you tapped it" instead of hedging. Without it every tap on
       * this map read as the agent's, on the page and in every link leaving it.
       *
       * A tap on a place that is *already* on the map no longer takes it off.
       * It opens the card instead, and the card's own Remove does the taking
       * off — because a tap has to be able to ask "what is this?" of a bead
       * the agent put there without deleting the agent's work to find out,
       * and because a mark that vanishes on the same gesture that would have
       * explained it is the interaction the card exists to replace
       * (design2-v5 §8.1 row 8: one card, two provenances).
       */
      const tapFeature = (id: string, at: { x: number; y: number }) => {
        const current = store.getState().selection;
        if (!current.includes(id)) store.getState().setSelection([...current, id], "user");
        card.getState().open({ kind: "feature", id, x: at.x, y: at.y });
      };
      map.on("click", INTERACTIVE_LAYER_IDS, (event) => {
        // While drawing, a click is a vertex, not a selection.
        if (draw.getState().mode !== "none") return;
        const id = event.features
          ?.map((f) => f.properties?.id)
          .find((value): value is string => typeof value === "string");
        if (id) tapFeature(id, event.point);
      });

      // A bead answers to two gestures, because it stands for two things. One
      // place: click it to take it off the map again, the same gesture every
      // other dot answers to. Several coalesced: click it to zoom to the point
      // where they separate — the alternative is a mark you can see, can count
      // and cannot reach.
      const beadLayers = [...BEAD_LAYER_IDS];
      map.on("click", beadLayers, (event) => {
        if (draw.getState().mode !== "none") return;
        const feature = event.features?.[0];
        if (!feature) return;
        const { id, cluster_id: cluster } = feature.properties as {
          id?: string;
          cluster_id?: number;
        };
        if (typeof cluster === "number") {
          const source = map.getSource(feature.source) as GeoJSONSource | undefined;
          const at = feature.geometry;
          if (!source || at.type !== "Point") return;
          void source
            .getClusterExpansionZoom(cluster)
            .then((zoom) => map.easeTo({ center: [at.coordinates[0], at.coordinates[1]], zoom }))
            .catch(() => {
              // The cluster left the source while the worker was answering.
            });
          return;
        }
        if (typeof id === "string") tapFeature(id, event.point);
      });

      /**
       * A person's tap on a shape, and the other half of the same door: a
       * drawing is a mark somebody made, so it answers "what is this, and
       * whose?" and offers to take itself off the map. `Remove` is
       * `removeDrawing` — the writer `undo` and the tools use.
       *
       * A place under the shape answers first. The fill is 18 % opaque, so a
       * bead inside a drawn circle is plainly visible through it, and a tap
       * that landed on the dot a person can see must not be answered by the
       * wash around it. MapLibre delivers both layer handlers for one click,
       * so the drawing's defers by asking what else is under the point.
       */
      const drawingLayers = [...DRAWING_LAYER_IDS];
      const overDrawing = [...INTERACTIVE_LAYER_IDS, ...beadLayers];
      map.on("click", drawingLayers, (event) => {
        if (draw.getState().mode !== "none") return;
        if (map.queryRenderedFeatures(event.point, { layers: overDrawing }).length > 0) return;
        const id = event.features
          ?.map((f) => f.properties?.id)
          .find((value): value is string => typeof value === "string");
        if (id) card.getState().open({ kind: "drawing", id, x: event.point.x, y: event.point.y });
      });

      const pointerLayers = [...INTERACTIVE_LAYER_IDS, ...beadLayers, ...drawingLayers];
      map.on("mouseenter", pointerLayers, () => {
        if (draw.getState().mode !== "none") return;
        canvas.style.cursor = "pointer";
      });
      map.on("mouseleave", pointerLayers, () => {
        if (draw.getState().mode !== "none") return;
        canvas.style.cursor = "";
      });

      ready = true;
      setStatus("ready");
      pushViewFromMap();
    });

    map.on("moveend", pushViewFromMap);

    // The card is anchored to a pixel, and a pixel stops meaning a place the
    // moment the camera moves. Closing it is the honest answer: re-projecting
    // it would keep a card on screen through a flight that took its subject
    // off it.
    map.on("movestart", () => card.getState().close());

    // --- Hand drawing -----------------------------------------------------
    // Registered outside `load` so drawing works even if the basemap never
    // arrives; the preview source is written through `setSourceData`, which is
    // a no-op until the style is up.

    const applyDrawCursor = (mode: DrawMode) => {
      map.getCanvas().style.cursor = mode === "polygon" ? "crosshair" : "";
      // Otherwise the second click of "double-click to finish" zooms the map.
      if (mode === "polygon") map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    };

    map.on("click", (event: MapMouseEvent) => {
      const state = draw.getState();
      if (state.mode !== "polygon") return;
      const last = state.draft[state.draft.length - 1];
      if (last) {
        const previous = map.project(last);
        const distance = Math.hypot(previous.x - event.point.x, previous.y - event.point.y);
        if (distance < VERTEX_SLOP_PX) return;
      }
      state.addVertex([event.lngLat.lng, event.lngLat.lat]);
    });

    map.on("dblclick", (event: MapMouseEvent) => {
      if (draw.getState().mode !== "polygon") return;
      event.preventDefault();
      draw.getState().finish();
    });

    const unsubscribe = store.subscribe((state, previous) => {
      if (state.view !== previous.view && !fromMap) applyView(state.view);
      // The first tool call dresses the page in agent chrome, and the
      // inspector lane it brings takes 336px of the map with it. The camera
      // centre has to move into what is left, and `bounds` has to say so —
      // otherwise the agent's very next `get_map_state` describes a corridor
      // that stopped existing on its own first call.
      if (bootMode(state) !== bootMode(previous)) {
        applyPadding();
        pushBoundsFromMap();
      }
      // Whatever took a place off the map — an agent's `select_features`, a
      // restored link replacing the selection, the card's own Remove — the
      // card about it goes with it. Left open it would offer "Remove" for a
      // place that is no longer there, and press it against a selection that
      // no longer holds the id. `closeFor` is a no-op for every other card.
      if (state.selection !== previous.selection) {
        const live = new Set(state.selection);
        for (const id of previous.selection) if (!live.has(id)) card.getState().closeFor(id);
      }
      // Markers do not need the style, so they are kept in sync from the start.
      if (state.annotations !== previous.annotations) {
        syncAnnotationMarkers(map, markers, state.annotations, tapAnnotation);
      }
      if (!ready) return;
      // Feature data carries the selection with it: `applyFeatureData` re-states
      // the flags against the data that just landed, so a separate diff pass
      // would only undo work it has already done.
      if (state.features !== previous.features) applyFeatureData(state.features, state.selection);
      else if (state.selection !== previous.selection) applySelectionState(state.selection);
      // A tier-2 category arriving changes nothing on screen on its own — only
      // the selected subset is ever drawn — but it does change which selected
      // ids can be placed, so it is one of the three inputs here.
      if (
        state.selection !== previous.selection ||
        state.features !== previous.features ||
        state.tier2Features !== previous.tier2Features
      ) {
        applySelectionMarks(state.tier2Features, state.features, state.selection);
        // A place that just became a bead has to stop being a grain, and one
        // that was deselected has to become a grain again.
        if (browse.getState().category) applyBrowse();
      }
      if (state.drawings !== previous.drawings) applyDrawings(map, state.drawings);
    });

    const unsubscribeDraw = draw.subscribe((state, previous) => {
      if (state.draft !== previous.draft) applyDraft(map, state.draft);
      if (state.mode !== previous.mode) applyDrawCursor(state.mode);
    });

    const unsubscribeBrowse = browse.subscribe((state, previous) => {
      if (!ready || state.category === previous.category) return;
      applyBrowse();
      // Leaving browse takes the budget with it; entering re-measures on the
      // `idle` the new data causes.
      if (!state.category) applyInkBudget();
    });

    // `idle` rather than `moveend`: the budget is a fact about the clusters
    // that are on screen, and after a pan those are still being clustered in
    // the worker when `moveend` fires. `idle` is the first moment the answer
    // is stable, and it also covers the pass right after new browse data.
    map.on("idle", applyInkBudget);

    syncAnnotationMarkers(map, markers, store.getState().annotations, tapAnnotation);
    applyDrawCursor(draw.getState().mode);

    return () => {
      window.removeEventListener("resize", applyPadding);
      setFxMap(null);
      unsubscribe();
      unsubscribeDraw();
      unsubscribeBrowse();
      for (const marker of markers.values()) marker.remove();
      markers.clear();
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
      {/* Off screen, not removed: the design has no place for a loading pill,
          but "did the basemap come up" is exactly what a headless run needs to
          read back. See `.gm-machine` in globals.css. */}
      <span ref={statusRef} data-testid="map-status" className="gm-machine">
        loading
      </span>
    </>
  );
}
