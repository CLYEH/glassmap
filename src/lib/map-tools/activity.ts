/**
 * The agent-activity feed's data layer: one humanised line per tool call.
 *
 * The page shows what the agent is doing while it does it, so a human who is
 * not reading JSON can still follow along. That makes this module observation
 * only — it never changes a tool's input, its return value or its errors.
 *
 * Three rules the copy follows:
 *  - one short line, in the product's voice: `Drew a circle, 800 m — “10-min walk” → drawing:1`;
 *  - no geometry, no URLs, no result objects: sizes, counts, ids and names only;
 *  - echoing human and OSM text (labels, notes, place names) is the point —
 *    that text is what makes a row recognisable — but it is truncated, and the
 *    untrustedContentHint on the tool's own return is what still governs the
 *    agent-facing answer.
 *
 * ## The sentence is born here (design2-v5 §8.1 row 11, §8.5 (c))
 *
 * The round-2 r4 finding that feed summaries should keep a machine voice is
 * **superseded** by the human-first repositioning: the page opens as a map for
 * a person, so the row a person reads first is a sentence, and the feed/ticker
 * voice split dies with it. One template per tool, written and tested in this
 * file rather than assembled in a component — a summary the UI could rewrite
 * is a summary two surfaces can disagree about, and the ticker and the feed
 * show the same string.
 *
 * What the sentence does **not** replace is the transparency spine: the feed
 * renders the mono tool name and the timestamp on every call row, and the
 * ids a row names stay inside the summary (`refIds`, typeset as code by
 * `ActivityFeed`). A reader who wants to check the row against the map still
 * has the tool that ran, when it ran, and the id it touched.
 *
 * Tool *results* are untouched by any of this. The agent reads JSON; this is
 * the page's own account, and the two must never be one string.
 */
import {
  ACTIVITY_FX_HIT_LIMIT,
  type ActivityEntry,
  type ActivityFx,
  type MapToolStore,
} from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { DATASETS, isFeatureCategory } from "@/lib/data/schema";
import { isMapCategory } from "@/lib/store/tier2";
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
 * A point for the page to draw, taken from a `{lng, lat}` a tool already
 * answered with. Reading the *result* rather than the input is what makes the
 * mark trustworthy: `near: "Daan Station"` is a name, and only the tool knows
 * which coordinate it resolved to. Anything unreadable comes back undefined so
 * the row simply has nothing to draw.
 */
function fxPoint(value: unknown): [number, number] | undefined {
  const o = rec(value);
  const lng = fin(o?.lng);
  const lat = fin(o?.lat);
  return lng !== undefined && lat !== undefined ? [round5(lng), round5(lat)] : undefined;
}

/**
 * The ids of the page a search returned, capped at ACTIVITY_FX_HIT_LIMIT. The
 * cap is a drawing decision — past a few dozen marks the map is a smear — and
 * it never touches the answer: `total` and `returned` still say what matched.
 */
function fxHitIds(result: Rec): string[] | undefined {
  if (!Array.isArray(result.features)) return undefined;
  const ids = result.features
    .slice(0, ACTIVITY_FX_HIT_LIMIT)
    .map((f) => str(rec(f)?.id))
    .filter((id): id is string => id !== undefined);
  return ids.length ? ids : undefined;
}

/**
 * One row's `fx`, with everything the answer did not state left out — and no
 * `fx` at all unless it has a point in it. A radius or a list of hits with
 * nowhere to put them is not something the page can draw, and a half-filled
 * object would invite it to fill the gap with the current view.
 */
function withFx(parts: ActivityFx): { fx?: ActivityFx } {
  if (!parts.origin && !parts.originB) return {};
  const fx: ActivityFx = {};
  if (parts.origin) fx.origin = parts.origin;
  if (parts.originB) fx.originB = parts.originB;
  if (parts.radius_m !== undefined) fx.radius_m = parts.radius_m;
  if (parts.hitIds?.length) fx.hitIds = parts.hitIds;
  return { fx };
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

/**
 * "Fast food", "Place of worship" — a POI category as a person would read it.
 * Not pluralised: the English plural of an OSM key is not mechanical, and a
 * wrong plural in the feed is worse than a bare noun.
 *
 * This is why the search rows keep their subject first — "Cafe near Daan
 * Station — found 42" — where the design mockup writes "Found 42 cafés inside
 * the circle" (design2-v5, `mockup2-v5.html`). Reaching that sentence needs a
 * noun inflected by the count for all 24 categories, in two numbers, and a
 * union form for a multi-category filter; no such vocabulary exists anywhere.
 * The chrome's nearest thing (`components/category-labels.ts`, `TIER2_PLURAL`)
 * is a browse-tray label map, not a count noun — "Worship", "Parking",
 * "Convenience" — so it would not serve this row even if the tool layer could
 * import upwards (it must not). Authoring 24 count-inflected nouns is a new
 * vocabulary (natural home: `src/lib/data/`, beside the schema), a separate
 * task. Same words, same order, one clause rearranged — declined here on
 * purpose, not overlooked.
 */
const poiLabel = (category: string) =>
  capitalise(category.replace(/_/g, " "));

/** "Parks", "Parks, Schools" — the same words the legend uses for the same data. */
function categoryLabel(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = value
    .filter(isMapCategory)
    .map((c) => (isFeatureCategory(c) ? DATASETS[c].label : poiLabel(c)));
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
  /**
   * Where on the map this call happened, for the page to draw. Only the four
   * tools whose answers state a point carry it; every other row is drawn from
   * `refIds` (the artifact it made or measured) or not at all. Nothing here is
   * derived: a value the result did not state is a value the row does without.
   */
  fx?: ActivityFx;
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
    // Where the camera actually ended up — the answer is the new map state, so
    // this is the landing point whether the caller named a place, an id or a
    // coordinate, and it is the only one of the three the page can draw.
    const fx = withFx({ origin: fxPoint(result.center) });
    const featureId = str(input.feature_id)?.trim();
    if (featureId) return { summary: `Flew to ${text(featureId)}${at}`, refIds: [featureId], ...fx };
    const place = str(input.place)?.trim();
    if (place) return { summary: `Flew to ${text(place)}${at}`, ...fx };
    const centre = pointOf(result.center);
    return { summary: centre ? `Camera at ${centre}${at}` : `Moved the camera${at}`, ...fx };
  },

  list_features_in_view: (input, result) => ({
    summary: `${categoryLabel(input.categories) ?? "Features"} in view — found ${group(
      fin(result.total) ?? 0,
    )}`,
  }),

  find_features: (input, result) => {
    const { subject, refIds } = filterSubject(input);
    return {
      summary: `${subject} — found ${group(fin(result.total) ?? 0)}`,
      refIds,
      // Everything drawable about a search is in its own answer: where it
      // measured from, how far it looked if it was bounded at all, and which
      // features came back. A search that bounded nothing gets no radius here
      // either — the page must not ring an area the tool never applied.
      ...withFx({
        origin: fxPoint(result.origin),
        radius_m: fin(result.radius_m),
        hitIds: fxHitIds(result),
      }),
    };
  },

  select_features: (_input, result) => {
    const selection = rec(rec(result.state)?.selection);
    const count = fin(selection?.count) ?? 0;
    const unknown = fin(result.unknown_count) ?? 0;
    // Ids the call kept but this page cannot resolve yet: a share link's
    // categories are still arriving. They are in the count, and they are not
    // on the map.
    const pending = Array.isArray(result.pending_ids) ? result.pending_ids.length : 0;
    // Selecting nothing is a real instruction ("clear it"), not an empty result.
    if (count === 0) return { summary: "Cleared the selection" };
    // "all" is the mockup's word for this row, and it is a claim: nothing the
    // call asked for was left off. It holds only when no id was rejected and
    // none is still loading — and "all 1" is not English, so a single match
    // keeps the bare count.
    const head = `Highlighted ${count > 1 && !unknown && !pending ? "all " : ""}${group(
      count,
    )} on the map`;
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
        // The verb, then what it made: "Drew a circle, 800 m" is the row the
        // design writes, and it is what tells a reader the map changed —
        // "Circle, 800 m" could as easily be a measurement of one.
        `Drew a ${kind}, ${size}`,
        label ? ` — ${quote(label)}` : "",
        id ? ` → ${id}` : "",
      ].join(""),
      ...(id ? { refIds: [id] } : {}),
    };
  },

  plan_route: (_input, result) => {
    const id = str(result.drawing_id);
    // The label rather than the caller's two ends: a route is usually named by
    // the tool itself, from the places it resolved, and that default is the
    // only description of the walk anyone has. Read from the answer, like
    // everything else here - the input may carry no name at all.
    const label = str(result.label)?.trim();
    return {
      summary: [
        `Planned a walk, ${metres(fin(result.distance_m) ?? 0)}`,
        label ? ` — ${quote(label)}` : "",
        id ? ` → ${id}` : "",
      ].join(""),
      ...(id ? { refIds: [id] } : {}),
      // Both ends, as the answer states them: the two places a route is
      // between are what the page has to show to show a route at all, and
      // compare_areas' second centre is the same field for the same reason.
      ...withFx({ origin: fxPoint(result.from), originB: fxPoint(result.to) }),
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

  remove_from_map: (_input, result) => {
    const removed = Array.isArray(result.removed) ? result.removed.map(rec) : [];
    const ids = removed.map((r) => str(r?.id)).filter((id): id is string => id !== undefined);
    const count = fin(result.removed_count) ?? ids.length;
    const first = removed[0];
    // One mark is named: the id and the words on it are what a reader checks
    // against the map they are looking at. Several are counted, because a row
    // listing five ids is a row nobody reads.
    const only = str(first?.label) ?? str(first?.note);
    const head =
      count === 0
        ? "Removed nothing"
        : count === 1
          ? `Removed ${ids[0] ?? "one mark"}${only ? ` — ${quote(only, ACTIVITY_NOTE_CHARS)}` : ""}`
          : `Removed ${group(count)} marks`;
    // What the human's own map kept, in their words: a refusal only ever
    // happens to a shape or a note they made themselves, and the row that does
    // not say so leaves them watching the agent apparently do nothing.
    const kept = fin(result.refused_count) ?? 0;
    // A malformed mark id and an id nothing answers to are one fact to a person
    // watching: the agent named something this map does not have.
    const missing = (fin(result.unknown_count) ?? 0) + (fin(result.malformed_count) ?? 0);
    return {
      summary: [
        head,
        kept ? ` · ${group(kept)} of yours kept` : "",
        missing ? ` · ${group(missing)} unknown ${missing === 1 ? "id" : "ids"}` : "",
      ].join(""),
      // The ids that left the map, so the page can play the removal where each
      // one was. Already capped by the answer itself.
      ...(ids.length ? { refIds: ids } : {}),
    };
  },

  describe_surroundings: (input, result) => {
    // The place the call was about wins over the district it turned out to be
    // in. The row and the map are looked at together: the page marks the
    // resolved origin, so a row reading "Around Daan District" while the mark
    // sits on one named park makes the feed contradict the screen. The tool's
    // own resolved name comes first — "osm:node:2" and "Daan Station" are both
    // that station, and only the tool knows which one they found — exactly as
    // compare_areas names its two sides. A call that named no place — a
    // coordinate, or the view centre — has nothing to prefer, and there the
    // district is still the most human answer.
    // Only the string forms are offered to placeLabel: a caller who gave a
    // coordinate named nowhere, and the district reads better than a row
    // repeating the numbers the mark is already sitting on.
    const where =
      placeLabel(str(input.from), result.name) ??
      str(result.district) ??
      pointOf(result.origin) ??
      "the view";
    const radius = fin(input.radius_m) ?? DEFAULT_SURROUNDINGS_RADIUS_M;
    // "places", not "features": every one of them is somewhere a person could
    // walk to — the district this call is standing in is the one thing that is
    // not counted here (it is the tool's own `district` field). The count is
    // inflected because "1 places within 500 m" reads as a bug in the map.
    const total = fin(result.total) ?? 0;
    return {
      summary: `Around ${where} — ${group(total)} ${
        total === 1 ? "place" : "places"
      } within ${metres(radius)}`,
      // The result echoes the point but not the radius, so the radius is the
      // one the tool would have used for this input — the same default the
      // schema documents, never a guess at a number the call did not have.
      ...withFx({ origin: fxPoint(result.origin), radius_m: radius }),
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
      // Two centres and the one radius they share: the shared radius is what
      // makes the comparison mean anything, and the answer states it, so the
      // page can show both sides being measured the same way.
      ...withFx({
        origin: fxPoint(a?.origin),
        originB: fxPoint(b?.origin),
        radius_m: radius,
      }),
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
  const { summary, refIds, fx } = summarise
    ? summarise(rec(input) ?? {}, out)
    : { summary: `Called ${tool}`, refIds: undefined, fx: undefined };
  // A refusal never gets here, so `fx` can only ever point at a place a call
  // really used: the row is drawn from the same answer the agent was given.
  return { summary, ok: true, ...(refIds?.length ? { refIds } : {}), ...(fx ? { fx } : {}) };
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
