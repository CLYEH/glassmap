/**
 * Share links — the whole map inside a URL hash.
 *
 * A GlassMap link has to work with no server, no account and no upload, so the
 * state travels in the fragment, which the browser never sends anywhere. This
 * module is the contract between the tool that builds a link (`get_share_link`)
 * and the UI that applies one on load and refreshes it on change, so it stays
 * free of `window`/`document`: both sides and the unit tests import it.
 *
 * Wire format
 * -----------
 *   hash := "v1." base64url(utf8(JSON payload))
 *
 * The version prefix sits outside the base64 so a build can reject a link it
 * does not understand by reading three characters instead of parsing it.
 *
 * Payload keys are one character each because every byte is paid for twice:
 * once in the JSON, then again as the +33 % base64 costs.
 *
 *   c  [lng, lat] camera centre     z  zoom
 *   b  bearing (omitted when 0)     p  pitch (omitted when 0)
 *   s  [feature id, …]              (omitted when empty)
 *   d  [drawing, …]                 a  [annotation, …]
 *
 *   drawing:     k kind, o source, l label?, and either
 *                c [lng, lat] + r radius_m — a circle, whose 65-point polygon is
 *                  rebuilt on the other side rather than carried;
 *                g [lng, lat, lng, lat, …] — a polygon ring without its closing
 *                  point, or a line.
 *   annotation:  o source, p [lng, lat], n note, i icon?
 *
 * Ids are deliberately not carried: `drawing:3` means nothing in the browser
 * that opens the link, and the store hands out ids itself. Decoding therefore
 * yields exactly what `addDrawing` / `addAnnotation` take as an argument.
 *
 * Decoding is tolerant on purpose — links get pasted, truncated and hand-edited.
 * A payload that is not v1, not base64url, not JSON, or has no camera comes back
 * as `{ error }`. Everything past that is best effort: an item that cannot be
 * rebuilt (impossible coordinates, more points than `draw_shape` would accept)
 * is dropped rather than costing the whole map, over-long text is clipped to the
 * same limits the tools enforce, and unknown keys are ignored so that a newer
 * build can add fields without breaking this one.
 */
import type { Position } from "geojson";
import type { Annotation, Drawing, LngLat, MapView } from "@/lib/store/map-store";
import { round5 } from "./state";
import {
  circleGeometry,
  MAX_ICON_CHARS,
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  MAX_RADIUS_M,
  MAX_SHAPE_POINTS,
  SHAPE_KINDS,
} from "./shapes";

export const SHARE_VERSION = "v1";
const PREFIX = `${SHARE_VERSION}.`;

/**
 * How long a share link may get, in bytes. 8 KB is the ceiling servers, proxies
 * and chat clients agree on; a link that is silently truncated somewhere between
 * two people is worse than no link at all.
 */
export const MAX_SHARE_URL_BYTES = 8192;

/**
 * How much text `decodeShareState` will look at. Twice the limit above accepts
 * every link this build can produce plus headroom for a future one, and bounds
 * the work a hostile link can ask for.
 */
export const MAX_SHARE_HASH_CHARS = 16_384;

/** A feature id is an id, not a payload; anything longer is not one of ours. */
const MAX_ID_CHARS = 128;

/** Drawings and annotations travel without their store-assigned ids. */
export type ShareDrawing = Omit<Drawing, "id">;
export type ShareAnnotation = Omit<Annotation, "id">;

/** What a link carries. `decodeShareState` returns this shape, so it re-encodes. */
export interface ShareState {
  view: MapView;
  selection: readonly string[];
  drawings: readonly ShareDrawing[];
  annotations: readonly ShareAnnotation[];
}

export interface DecodedShareState {
  view: MapView;
  selection: string[];
  drawings: ShareDrawing[];
  annotations: ShareAnnotation[];
}

// --------------------------------------------------------------------- wire

interface WireDrawing {
  k: string;
  o: string;
  l?: string;
  c?: [number, number];
  r?: number;
  g?: number[];
}

interface WireAnnotation {
  o: string;
  p: [number, number];
  n: string;
  i?: string;
}

interface WirePayload {
  c: [number, number];
  z: number;
  b?: number;
  p?: number;
  s?: string[];
  d?: WireDrawing[];
  a?: WireAnnotation[];
}

// ----------------------------------------------------------------- helpers

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isLngLat = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length >= 2 &&
  isNum(v[0]) &&
  isNum(v[1]) &&
  v[0] >= -180 &&
  v[0] <= 180 &&
  v[1] >= -90 &&
  v[1] <= 90;

/** Radius to the centimetre: a circle nobody can see the difference in, half the digits. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const roundPoint = (p: readonly number[]): [number, number] => [round5(p[0]), round5(p[1])];

/**
 * Clip over-long text to the limit the tools enforce, without ever cutting a
 * surrogate pair in half — half an emoji renders as a replacement box on the
 * map, and this only ever runs on text that did not come from our own tools.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Optional free text as it goes on the wire: absent when blank, never over-long. */
function shareText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? clip(trimmed, max) : undefined;
}

/** [lng, lat, lng, lat, …]: two characters of JSON syntax per point, not four. */
function flatten(points: readonly Position[]): number[] | null {
  const out: number[] = [];
  for (const p of points) {
    if (!isLngLat(p)) return null;
    out.push(round5(p[0]), round5(p[1]));
  }
  return out;
}

function unflatten(value: unknown, minPoints: number): Position[] | null {
  if (!Array.isArray(value) || value.length % 2 !== 0) return null;
  const count = value.length / 2;
  // The same ceiling draw_shape enforces: a link must not be able to hand the
  // UI a shape it would refuse to accept from a tool call.
  if (count < minPoints || count > MAX_SHAPE_POINTS) return null;
  const points: Position[] = [];
  for (let i = 0; i < value.length; i += 2) {
    const point = [value[i], value[i + 1]];
    if (!isLngLat(point)) return null;
    points.push(roundPoint(point));
  }
  return points;
}

const samePoint = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** GeoJSON wants a closed ring; the wire does not carry the repeat. */
function closeRing(points: Position[]): Position[] | null {
  const ring = samePoint(points[0], points[points.length - 1]) ? points : [...points, points[0]];
  const distinct = new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;
  return distinct >= 3 ? ring : null;
}

// ---------------------------------------------------------------- base64url

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // Chunked concatenation rather than String.fromCharCode(...bytes): a 8 KB
  // spread is fine, a hostile 1 MB one overflows the call stack.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(payload: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  try {
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // fatal: a truncated link that happens to decode as base64 must fail here
    // rather than turn someone's note into replacement characters.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- encode

/**
 * A drawing on the wire, or null when its geometry cannot be rebuilt from what
 * we would write down. The store's invariant (a circle and a polygon are
 * Polygons, a line is a LineString) makes null unreachable in practice;
 * `get_share_link` checks for it anyway, because a shape the human drew and the
 * link quietly lost is the one failure this feature must never hide.
 */
function encodeDrawing(drawing: ShareDrawing): WireDrawing | null {
  const wire: WireDrawing = { k: drawing.kind, o: drawing.source };
  const label = shareText(drawing.label, MAX_LABEL_CHARS);
  if (label) wire.l = label;

  if (drawing.kind === "circle" && isLngLat(drawing.center) && isNum(drawing.radius_m)) {
    if (drawing.radius_m <= 0 || drawing.radius_m > MAX_RADIUS_M) return null;
    return { ...wire, c: roundPoint(drawing.center), r: round2(drawing.radius_m) };
  }

  const geometry = drawing.geometry;
  if (!geometry) return null;
  if (geometry.type === "LineString") {
    const flat = flatten(geometry.coordinates);
    return flat && flat.length >= 4 ? { ...wire, g: flat } : null;
  }
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    if (!ring || ring.length < 4) return null;
    // Drop the closing point: decode re-closes the ring.
    const open = samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
    const flat = flatten(open);
    return flat && flat.length >= 6 ? { ...wire, g: flat } : null;
  }
  return null;
}

function encodeAnnotation(annotation: ShareAnnotation): WireAnnotation | null {
  const note = shareText(annotation.note, MAX_NOTE_CHARS);
  if (!note || !isLngLat(annotation.at)) return null;
  const wire: WireAnnotation = { o: annotation.source, p: roundPoint(annotation.at), n: note };
  const icon = shareText(annotation.icon, MAX_ICON_CHARS);
  if (icon) wire.i = icon;
  return wire;
}

/**
 * The map as a URL fragment (without the leading "#"). Coordinates are rounded
 * to 5 decimals (~1 m) — the same rounding every tool answer uses, so the link
 * cannot disagree with what the agent said out loud.
 */
export function encodeShareState(input: ShareState): string {
  const view = input.view;
  const payload: WirePayload = {
    c: roundPoint(view.center),
    z: round5(view.zoom),
  };
  if (view.bearing) payload.b = round5(((view.bearing % 360) + 360) % 360);
  if (view.pitch) payload.p = round5(view.pitch);

  const selection = input.selection.filter(
    (id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS,
  );
  if (selection.length) payload.s = [...new Set(selection)];

  const drawings = input.drawings.map(encodeDrawing).filter((d): d is WireDrawing => d !== null);
  if (drawings.length) payload.d = drawings;

  const annotations = input.annotations
    .map(encodeAnnotation)
    .filter((a): a is WireAnnotation => a !== null);
  if (annotations.length) payload.a = annotations;

  return PREFIX + toBase64Url(JSON.stringify(payload));
}

// ------------------------------------------------------------------- decode

function decodeView(payload: Record<string, unknown>): MapView | null {
  const center = payload.c;
  const zoom = payload.z;
  if (!isLngLat(center)) return null;
  if (!isNum(zoom) || zoom < 0 || zoom > 22) return null;
  const bearing = isNum(payload.b) ? ((payload.b % 360) + 360) % 360 : 0;
  const pitch = isNum(payload.p) ? Math.min(Math.max(payload.p, 0), 85) : 0;
  return {
    center: roundPoint(center),
    zoom: round5(zoom),
    bearing: round5(bearing),
    pitch: round5(pitch),
  };
}

function decodeDrawing(value: unknown): ShareDrawing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wire = value as Record<string, unknown>;
  const kind = wire.k;
  if (typeof kind !== "string" || !(SHAPE_KINDS as readonly string[]).includes(kind)) return null;
  const base: { source: Drawing["source"]; kind: Drawing["kind"]; label?: string } = {
    // A link written by a stranger cannot claim a shape was drawn by the human:
    // "user" is the map's word for "someone in this room drew this".
    source: wire.o === "user" ? "user" : "agent",
    kind: kind as Drawing["kind"],
  };
  const label = shareText(wire.l, MAX_LABEL_CHARS);
  if (label) base.label = label;

  if (kind === "circle" && isLngLat(wire.c) && isNum(wire.r)) {
    if (wire.r <= 0 || wire.r > MAX_RADIUS_M) return null;
    const center: LngLat = roundPoint(wire.c);
    const radius_m = round2(wire.r);
    return { ...base, geometry: circleGeometry(center, radius_m), center, radius_m };
  }

  const points = unflatten(wire.g, kind === "line" ? 2 : 3);
  if (!points) return null;
  if (kind === "line") return { ...base, geometry: { type: "LineString", coordinates: points } };
  const ring = closeRing(points);
  if (!ring) return null;
  return { ...base, geometry: { type: "Polygon", coordinates: [ring] } };
}

function decodeAnnotation(value: unknown): ShareAnnotation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wire = value as Record<string, unknown>;
  const note = shareText(wire.n, MAX_NOTE_CHARS);
  if (!note || !isLngLat(wire.p)) return null;
  const annotation: ShareAnnotation = {
    source: wire.o === "user" ? "user" : "agent",
    at: roundPoint(wire.p),
    note,
  };
  const icon = shareText(wire.i, MAX_ICON_CHARS);
  if (icon) annotation.icon = icon;
  return annotation;
}

/**
 * A hash (with or without its leading "#") back into map state, or `{ error }`.
 * Never throws: this runs on whatever text was in someone's address bar.
 */
export function decodeShareState(hash: string): DecodedShareState | { error: string } {
  if (typeof hash !== "string") return { error: "share link is not a string" };
  const text = hash.trim().replace(/^#/, "").trim();
  if (!text) return { error: "share link is empty" };
  if (text.length > MAX_SHARE_HASH_CHARS) {
    return { error: `share link is too long: ${text.length} characters` };
  }
  if (!text.startsWith(PREFIX)) {
    const version = /^(v\d+)\./.exec(text);
    return {
      error: version
        ? `unsupported share link version "${version[1]}": this build reads ${SHARE_VERSION}`
        : `not a GlassMap share link: expected it to start with "${PREFIX}"`,
    };
  }

  const json = fromBase64Url(text.slice(PREFIX.length));
  if (json === null) return { error: "share link payload is not valid base64url" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "share link payload is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "share link payload is not an object" };
  }
  const payload = parsed as Record<string, unknown>;

  const view = decodeView(payload);
  // Without a camera there is no map to restore, and guessing one would drop
  // whoever opened the link somewhere they were never invited to.
  if (!view) return { error: "share link has no valid camera position" };

  const rawSelection = Array.isArray(payload.s) ? payload.s : [];
  const selection = [
    ...new Set(
      rawSelection.filter(
        (id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS,
      ),
    ),
  ];

  const rawDrawings = Array.isArray(payload.d) ? payload.d : [];
  const drawings = rawDrawings
    .map(decodeDrawing)
    .filter((d): d is ShareDrawing => d !== null);

  const rawAnnotations = Array.isArray(payload.a) ? payload.a : [];
  const annotations = rawAnnotations
    .map(decodeAnnotation)
    .filter((a): a is ShareAnnotation => a !== null);

  return { view, selection, drawings, annotations };
}

/** Byte length of a string as it travels in a URL; the number get_share_link reports. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
