import type { GlassMapTool } from "@/lib/webmcp/types";
import type { MapToolStore, MapView } from "@/lib/store/map-store";
import { describeView } from "./state";

export interface SetMapViewInput {
  center?: { lng: number; lat: number };
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Returns a validated patch, or an error message. Never throws. */
export function validateSetMapView(input: SetMapViewInput): { patch: Partial<MapView> } | { error: string } {
  const patch: Partial<MapView> = {};
  if (input.center !== undefined) {
    const { lng, lat } = input.center ?? {};
    if (!isNum(lng) || !isNum(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return { error: "center must be {lng:-180..180, lat:-90..90}" };
    }
    patch.center = [lng, lat];
  }
  if (input.zoom !== undefined) {
    if (!isNum(input.zoom) || input.zoom < 0 || input.zoom > 22) return { error: "zoom must be 0..22" };
    patch.zoom = input.zoom;
  }
  if (input.bearing !== undefined) {
    if (!isNum(input.bearing)) return { error: "bearing must be a number (degrees)" };
    patch.bearing = ((input.bearing % 360) + 360) % 360;
  }
  if (input.pitch !== undefined) {
    if (!isNum(input.pitch) || input.pitch < 0 || input.pitch > 85) return { error: "pitch must be 0..85" };
    patch.pitch = input.pitch;
  }
  if (Object.keys(patch).length === 0) return { error: "provide at least one of center, zoom, bearing, pitch" };
  return { patch };
}

export function createMapTools(store: MapToolStore): GlassMapTool[] {
  const getMapState: GlassMapTool = {
    name: "get_map_state",
    description:
      "Read the current map view (center, zoom, bearing, pitch). Use this instead of a screenshot to know what the map shows.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => describeView(store.getView()),
  };

  const setMapView: GlassMapTool<SetMapViewInput> = {
    name: "set_map_view",
    description:
      "Move the map camera. Any of center {lng,lat}, zoom (0-22), bearing (deg), pitch (0-85) may be given. Returns the new map state.",
    inputSchema: {
      type: "object",
      properties: {
        center: {
          type: "object",
          properties: { lng: { type: "number" }, lat: { type: "number" } },
          required: ["lng", "lat"],
        },
        zoom: { type: "number", minimum: 0, maximum: 22 },
        bearing: { type: "number" },
        pitch: { type: "number", minimum: 0, maximum: 85 },
      },
      additionalProperties: false,
    },
    execute: (input) => {
      const v = validateSetMapView(input ?? {});
      if ("error" in v) return { error: v.error, state: describeView(store.getView()) };
      store.setView(v.patch);
      return describeView(store.getView());
    },
  };

  return [getMapState, setMapView as GlassMapTool];
}
