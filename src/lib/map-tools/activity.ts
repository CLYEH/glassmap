/**
 * The agent-activity feed's data layer: one humanised line per tool call.
 *
 * The page shows what the agent is doing while it does it, so a human who is
 * not reading JSON can still follow along. That makes this module observation
 * only — it never changes a tool's input, its return value or its errors.
 *
 * Three rules the copy follows:
 *  - one short line, in the product's voice: `Circle, 800 m — “10-min walk” → drawing:1`;
 *  - no geometry, no URLs, no result objects: sizes, counts, ids and names only;
 *  - echoing human and OSM text (labels, notes, place names) is the point —
 *    that text is what makes a row recognisable — but it is truncated, and the
 *    untrustedContentHint on the tool's own return is what still governs the
 *    agent-facing answer.
 */
import type { ActivityEntry, MapToolStore } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { DATASETS, isFeatureCategory } from "@/lib/data/schema";
import { DEFAULT_CIRCLE_RADIUS_M, truncate } from "./shapes";
import { DEFAULT_SURROUNDINGS_RADIUS_M } from "./surroundings";
import { round5 } from "./state";

/** How much human/OSM text a label, place or name may contribute to one line. */
export const ACTIVITY_TEXT_CHARS = 48;

/** Notes are sentences, so they get a little more room than a label. */
export const ACTIVITY_NOTE_CHARS = 60;

/** Tool errors explain themselves at length; a feed row only has one line. */
export const ACTIVITY_ERROR_CHARS = 80;

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec | undefined =>
  typeof v === "object" && v !== null ? (v as Rec) : undefined;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const fin = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const text = (v: string, max = ACTIVITY_TEXT_CHARS) => truncate(v.trim(), max);

const quote = (v: string, max = ACTIVITY_TEXT_CHARS) => `“${text(v, max)}”`;

/** 2063 → "2,063". Written out rather than localised so it cannot vary by ICU build. */
const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const metres = (n: number) => `${group(n)} m`;

const squareMetres = (n: number) => `${group(n)} m²`;

/** Latitude first, the way the camera chip and every map UI says it. */
const coords = (lng: number, lat: number) => `${round5(lat)}, ${round5(lng)}`;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A `{lng, lat}` pair from an input or from a result, in either shape. */
function pointOf(value: unknown): string | undefined {
  const o = rec(value);
  const lng = fin(o?.lng);
  const lat = fin(o?.lat);
  return lng !== undefined && lat !== undefined ? coords(lng, lat) : undefined;
}

/**
 * How a row names a place: the name the caller used, or the coordinate they
 * gave. `resolved` is the name the tool looked the place up as, which is more
 * accurate than what was typed and so wins when the tool reports one.
 */
function placeLabel(value: unknown, resolved?: unknown): string | undefined {
  const name = str(resolved)?.trim();
  if (name) return text(name);
  const asked = str(value)?.trim();
  if (asked) return text(asked);
  return pointOf(value);
}

/** "Parks", "Parks, Schools" — the same words the legend uses for the same data. */
function categoryLabel(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = value.filter(isFeatureCategory).map((c) => DATASETS[c].label);
  return labels.length ? labels.join(", ") : undefined;
}

/**
 * What find_features and select_features were asked for, as a noun phrase:
 * "Parks within drawing:1", "Supermarkets near Daan Station", "“sushi”".
 * `within` beats `near` because it names a shape the human can see on the map.
 */
function filterSubject(input: Rec): { subject: string; refIds: string[] } {
  const categories = categoryLabel(input.categories);
  const query = str(input.query)?.trim();
  let subject = categories ?? (query ? quote(query) : "Features");
  if (categories && query) subject = `${categories} matching ${quote(query)}`;

  const within = str(input.within)?.trim();
  if (within) return { subject: `${subject} within ${within}`, refIds: [within] };

  const near = placeLabel(input.near);
  return { subject: near ? `${subject} near ${near}` : subject, refIds: [] };
}

interface Summary {
  summary: string;
  refIds?: string[];
}

/** Both arguments are already known to be plain objects, never null. */
type Summariser = (input: Rec, result: Rec) => Summary;

const SUMMARISERS: Record<string, Summariser> = {
  get_map_state: (_input, result) => ({
    summary: `Read the camera — ${group(fin(result.features_loaded) ?? 0)} features loaded`,
  }),

  set_map_view: (input, result) => {
    const zoom = fin(result.zoom);
    const at = zoom === undefined ? "" : ` · z${round5(zoom)}`;
    const featureId = str(input.feature_id)?.trim();
    if (featureId) return { summary: `Flew to ${text(featureId)}${at}`, refIds: [featureId] };
    const place = str(input.place)?.trim();
    if (place) return { summary: `Flew to ${text(place)}${at}` };
    const centre = pointOf(result.center);
    return { summary: centre ? `Camera at ${centre}${at}` : `Moved the camera${at}` };
  },

  list_features_in_view: (input, result) => ({
    summary: `${categoryLabel(input.categories) ?? "Features"} in view — found ${group(
      fin(result.total) ?? 0,
    )}`,
  }),

  find_features: (input, result) => {
    const { subject, refIds } = filterSubject(input);
    return { summary: `${subject} — found ${group(fin(result.total) ?? 0)}`, refIds };
  },

  select_features: (_input, result) => {
    const selection = rec(rec(result.state)?.selection);
    const count = fin(selection?.count) ?? 0;
    const unknown = fin(result.unknown_count) ?? 0;
    // Selecting nothing is a real instruction ("clear it"), not an empty result.
    const head = count === 0 ? "Cleared the selection" : `Highlighted ${group(count)} on the map`;
    return {
      summary: unknown ? `${head} · ${group(unknown)} unknown ${unknown === 1 ? "id" : "ids"}` : head,
    };
  },

  draw_shape: (input, result) => {
    const kind = str(input.type) ?? "shape";
    const size =
      kind === "circle"
        ? metres(fin(input.radius_m) ?? DEFAULT_CIRCLE_RADIUS_M)
        : kind === "line"
          ? metres(fin(result.length_m) ?? 0)
          : squareMetres(fin(result.area_m2) ?? 0);
    const label = str(input.label)?.trim();
    const id = str(result.drawing_id);
    return {
      summary: [
        `${capitalise(kind)}, ${size}`,
        label ? ` — ${quote(label)}` : "",
        id ? ` → ${id}` : "",
      ].join(""),
      ...(id ? { refIds: [id] } : {}),
    };
  },

  annotate: (input, result) => {
    const note = str(input.note)?.trim() ?? "";
    const id = str(result.annotation_id);
    return {
      summary: `Pinned ${quote(note, ACTIVITY_NOTE_CHARS)}${id ? ` → ${id}` : ""}`,
      ...(id ? { refIds: [id] } : {}),
    };
  },

  describe_surroundings: (input, result) => {
    const where =
      str(result.district) ?? placeLabel(input.from) ?? pointOf(result.origin) ?? "the view";
    const radius = fin(input.radius_m) ?? DEFAULT_SURROUNDINGS_RADIUS_M;
    return {
      summary: `Around ${where} — ${group(fin(result.total) ?? 0)} features within ${metres(radius)}`,
    };
  },

  compare_areas: (input, result) => {
    const a = rec(result.a);
    const b = rec(result.b);
    const left = placeLabel(input.a, a?.name) ?? pointOf(a?.origin) ?? "a";
    const right = placeLabel(input.b, b?.name) ?? pointOf(b?.origin) ?? "b";
    const radius = fin(result.radius_m);
    return {
      summary: `Compared ${left} with ${right}${radius === undefined ? "" : ` · ${metres(radius)}`}`,
    };
  },

  measure: (_input, result) => {
    const target = str(result.target) ?? "";
    const area = fin(result.area_m2);
    const length = fin(result.length_m);
    const size = area !== undefined ? squareMetres(area) : length !== undefined ? metres(length) : "";
    return {
      summary: `Measured ${target}${size ? ` — ${size}` : ""}`,
      ...(target ? { refIds: [target] } : {}),
    };
  },

  get_share_link: (_input, result) => {
    // The URL carries the whole map state and is far too long for a feed row;
    // its size is the part a human can act on ("that will not fit in a link").
    const omitted = rec(result.omitted);
    const left = (fin(omitted?.drawings) ?? 0) + (fin(omitted?.annotations) ?? 0);
    return {
      summary: `Built a share link — ${group(fin(result.bytes) ?? 0)} bytes${
        left ? ` · ${group(left)} left out` : ""
      }`,
    };
  },
};

/**
 * The tools this module has feed copy for. A tool missing from here would
 * still be recorded, but as a bare "Called x" — the test asserts the two lists
 * match so a new tool cannot ship without a line a human can read.
 */
export const ACTIVITY_SUMMARY_TOOLS: readonly string[] = Object.keys(SUMMARISERS);

/**
 * One feed row from a call's input and its answer. A returned `error` is a
 * refusal, not a crash: the agent was told no, and the human should see that
 * as plainly as a success.
 */
export function describeCall(
  tool: string,
  input: unknown,
  result: unknown,
): Omit<ActivityEntry, "seq" | "at" | "tool" | "readOnly"> {
  const out = rec(result) ?? {};
  const error = str(out.error);
  if (error) return { summary: `Refused — ${text(error, ACTIVITY_ERROR_CHARS)}`, ok: false };
  const summarise = SUMMARISERS[tool];
  const { summary, refIds } = summarise
    ? summarise(rec(input) ?? {}, out)
    : { summary: `Called ${tool}`, refIds: undefined };
  return { summary, ok: true, ...(refIds?.length ? { refIds } : {}) };
}

/**
 * The same tool, recording every call it serves into the activity feed.
 *
 * Wrapping here rather than at registration keeps the feed honest: the order
 * rows appear in is the order calls actually completed, whatever surface made
 * them (`document.modelContext`, `navigator.modelContext`, the dev shim or a
 * test), and no caller can bypass it.
 */
export function withActivity(tool: GlassMapTool, store: MapToolStore): GlassMapTool {
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    ...tool,
    async execute(input, opts) {
      let result: unknown;
      try {
        result = await tool.execute(input, opts);
      } catch (e) {
        // Tools are contracted not to throw. If one does anyway, the human
        // still watched the agent make that call: a silent row is a worse lie
        // than an ugly one.
        const message = e instanceof Error ? e.message : String(e);
        store.recordActivity({
          tool: tool.name,
          summary: `Failed — ${text(message, ACTIVITY_ERROR_CHARS)}`,
          readOnly,
          ok: false,
        });
        throw e;
      }
      store.recordActivity({ tool: tool.name, readOnly, ...describeCall(tool.name, input, result) });
      return result;
    },
  };
}
