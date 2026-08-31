/**
 * remove_from_map: the agent's half of the gesture the card already gives the
 * human — tap a mark, see who made it, press Remove.
 *
 * Three things these tests hold, and each one is a way the tool could quietly
 * do harm instead of failing:
 *  - the selection is read before the feature list, because the ids most in
 *    need of removing are exactly the ones this page can no longer resolve;
 *  - a shape or a note the human made is not the agent's to delete, and saying
 *    so must not cost the rest of the batch;
 *  - removal is permanent, so an id that could not be acted on is named rather
 *    than swallowed.
 */
import { describe, expect, it } from "vitest";
import { createMapTools, MAX_IDS } from "./index";
import {
  createMemoryToolStore,
  type Annotation,
  type MapToolStore,
  type MemoryToolStoreInit,
} from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { MapStateOutput } from "./state";
import { SELECTION_ID_LIMIT } from "./state";
import { NOTE_PREVIEW_CHARS } from "./state";
import type { RefusedEntry, RemovedEntry } from "./remove";
import { FIXTURE_FEATURES, USER_DRAWN_AREA, USER_DRAWN_LINE, VIEW, VIEW_BOUNDS } from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  removed?: RemovedEntry[];
  removed_count?: number;
  refused?: RefusedEntry[];
  refused_count?: number;
  refused_reason?: string;
  not_selected?: string[];
  not_selected_count?: number;
  malformed_ids?: string[];
  malformed_count?: number;
  malformed_error?: string;
  unknown_ids?: string[];
  unknown_count?: number;
  known_ids?: string[];
  known_count?: number;
  drawing_id?: string;
  annotation_id?: string;
  state?: MapStateOutput;
}

function mapReady(over: MemoryToolStoreInit = {}) {
  const store: MapToolStore = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    ...over,
  });
  const byName = Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  return { store, byName };
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const userNote = (id: string, note: string): Annotation => ({
  id,
  source: "user",
  at: [121.5436, 25.0334],
  note,
});

describe("remove_from_map dispatch", () => {
  it("takes the agent's own shape off the map and answers with the state that proves it", async () => {
    const { store, byName } = mapReady();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: "Daan Station",
      radius_m: 400,
      label: "10-min walk",
    });
    const out = await call(byName.remove_from_map, { ids: [drawn.drawing_id as string] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([
      { id: "drawing:1", kind: "drawing", source: "agent", label: "10-min walk" },
    ]);
    expect(out.removed_count).toBe(1);
    expect(store.getDrawings()).toEqual([]);
    // A write tool answers with the map, so the agent never has to read back to
    // find out whether the shape is gone.
    expect(out.state?.drawings).toEqual({ count: 0, items: [] });
    expect(Object.keys(out.state ?? {}).sort()).toEqual(
      Object.keys(await call(byName.get_map_state)).sort(),
    );
  });

  it("takes the agent's own note off the map, with the words it removed", async () => {
    const { store, byName } = mapReady();
    await call(byName.annotate, { at: "Daan Station", note: "Viewing at 3pm" });
    const out = await call(byName.remove_from_map, { ids: ["annotation:1"] });

    expect(out.removed).toEqual([
      { id: "annotation:1", kind: "annotation", source: "agent", note: "Viewing at 3pm" },
    ]);
    expect(store.getAnnotations()).toEqual([]);
    expect(out.state?.annotations).toEqual({ count: 0, items: [] });
  });

  it("deselects a selected id the page can no longer resolve", async () => {
    /*
     * The whole reason the selection is read first. A share link whose
     * point-of-interest category failed permanently leaves ids selected that
     * `getFeatures()` will never name — and asking the feature list first would
     * call such an id unknown and refuse to remove the one thing a human can
     * see stuck in their highlight.
     */
    const { store, byName } = mapReady({
      selection: ["osm:node:2", "osm:node:900", "osm:way:10"],
    });
    const out = await call(byName.remove_from_map, { ids: ["osm:node:900"] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([{ id: "osm:node:900", kind: "selection" }]);
    expect(out.unknown_ids).toEqual([]);
    expect(store.getSelection()).toEqual(["osm:node:2", "osm:way:10"]);
  });

  it("removes only the named ids from the selection, whether or not the rest resolve", async () => {
    /*
     * select_features prunes ids it cannot resolve on every write. Reusing that
     * filter here would make "take this one out" quietly drop a share link's
     * other ids as a side effect — and because the address bar is rewritten
     * from the store, the recipient's own link would carry the loss on.
     */
    const { store, byName } = mapReady({
      selection: ["osm:node:2", "osm:node:900", "osm:node:901"],
    });
    await call(byName.remove_from_map, { ids: ["osm:node:2"] });
    expect(store.getSelection()).toEqual(["osm:node:900", "osm:node:901"]);
  });

  it("leaves the remaining ids attributed to whoever chose them", async () => {
    // The map only ever says what it was told about who selected what. A
    // deselect knows nothing new about the ids that stay, so it must not
    // rewrite them — "1 selected by you" would silently become "1 by the agent".
    const { store, byName } = mapReady();
    store.setSelection(["osm:way:10", "osm:node:2"], { "osm:way:10": "user", "osm:node:2": "agent" });
    const out = await call(byName.remove_from_map, { ids: ["osm:node:2"] });

    expect(out.removed).toEqual([{ id: "osm:node:2", kind: "selection", source: "agent" }]);
    expect(store.getSelection()).toEqual(["osm:way:10"]);
    expect(store.getSelectionSources()).toEqual({ "osm:way:10": "user" });
  });

  it("separates a loaded feature that was never highlighted from an id nothing answers to", async () => {
    // Two different facts: one is "there was nothing to take out", the other is
    // "you have a bad id". Folding them together would send the agent looking
    // for a typo in an id that is perfectly good.
    const { store, byName } = mapReady({ selection: ["osm:way:10"] });
    const out = await call(byName.remove_from_map, { ids: ["osm:node:2", "osm:node:999"] });

    expect(out.error).toBeUndefined();
    expect(out.not_selected).toEqual(["osm:node:2"]);
    expect(out.not_selected_count).toBe(1);
    expect(out.unknown_ids).toEqual(["osm:node:999"]);
    expect(out.unknown_count).toBe(1);
    expect(out.removed).toEqual([]);
    expect(store.getSelection()).toEqual(["osm:way:10"]);
  });

  it("counts a repeated id once, however it was spaced", async () => {
    const { store, byName } = mapReady();
    await call(byName.draw_shape, { type: "circle", center: "Daan Station" });
    const out = await call(byName.remove_from_map, {
      ids: ["drawing:1", " drawing:1 ", "drawing:1"],
    });
    expect(out.removed_count).toBe(1);
    expect(out.unknown_ids).toEqual([]);
    expect(store.getDrawings()).toEqual([]);
  });
});

describe("remove_from_map provenance", () => {
  it("refuses the human's own shape per id, and still removes the agent's in the same call", async () => {
    /*
     * The asymmetry the whole tool turns on. Removal is permanent and a
     * hand-drawn shape is content, so the agent does not get to delete it — but
     * saying so must not become a top-level error: that would flip the whole
     * activity row to "Refused" and hide the shape that really was removed.
     */
    const { store, byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const drawn = await call(byName.draw_shape, { type: "circle", center: "Daan Station" });
    const out = await call(byName.remove_from_map, {
      ids: ["drawing:1", drawn.drawing_id as string],
    });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([{ id: "drawing:2", kind: "drawing", source: "agent" }]);
    expect(out.refused).toEqual([{ id: "drawing:1", kind: "drawing", source: "user" }]);
    expect(out.refused_count).toBe(1);
    // The human's shape is exactly where they left it.
    expect(store.getDrawings().map((d) => d.id)).toEqual(["drawing:1"]);
  });

  it("refuses the human's own note the same way, whatever kind of mark it is", async () => {
    const { store, byName } = mapReady({ annotations: [userNote("annotation:1", "Landlord called")] });
    const out = await call(byName.remove_from_map, { ids: ["annotation:1"] });

    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([{ id: "annotation:1", kind: "annotation", source: "user" }]);
    expect(store.getAnnotations()).toHaveLength(1);
  });

  it("names the one tap that does work, once, however many ids were refused", async () => {
    /*
     * There is no override flag: an override is a confirmation dialog by
     * another name. The refusal is only useful if it says what the human can do
     * instead, in the words the card on the map uses — and it says it once for
     * the call. Repeating a 120-character sentence per id is an answer the
     * agent pays for by the token to be told the same thing twenty times.
     */
    const { byName } = mapReady({
      drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE],
      annotations: [userNote("annotation:1", "mine")],
    });
    const out = await call(byName.remove_from_map, {
      ids: ["drawing:1", "drawing:2", "annotation:1"],
    });

    expect(out.refused_count).toBe(3);
    expect(out.refused_reason).toBe(
      "The human made these by hand - a shape they drew or a note they wrote - so taking one off the map is theirs to do: they can tap it on the map and press Remove.",
    );
    expect(JSON.stringify(out.refused)).not.toMatch(/tap it on the map/);
  });

  it("refuses a hand-drawn shape even when its id is also sitting in the selection", async () => {
    /*
     * The selection is not validated by everyone who writes it: while a share
     * link's categories are pending, select_features keeps any non-empty id it
     * cannot resolve (and nothing prunes it when they settle), and the restore
     * in components/share-hash.ts applies a decoded selection as it stands. So
     * "drawing:1" really can be in there — and reading the selection first
     * would answer `removed: [{kind: "selection"}]` about a shape still on the
     * map, silently defeating this refusal. A live mark is a mark first.
     */
    const { store, byName } = mapReady({
      drawings: [USER_DRAWN_AREA],
      selection: ["drawing:1", "osm:node:2"],
    });
    const out = await call(byName.remove_from_map, { ids: ["drawing:1"] });

    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([{ id: "drawing:1", kind: "drawing", source: "user" }]);
    // Nothing was taken off anything: the shape is on the map, and the stray id
    // is still in the highlight, where the state this answer carries shows it.
    expect(store.getDrawings().map((d) => d.id)).toEqual(["drawing:1"]);
    expect(store.getSelection()).toEqual(["drawing:1", "osm:node:2"]);
    expect(out.state?.selection.ids).toContain("drawing:1");
  });

  it("removes its own mark and leaves the selection alone: one id, one action, one report", async () => {
    // The same rule pointing the other way. The mark branch never touches the
    // selection, so the answer can never say "removed" twice about one id, and
    // the stray entry the returned state still shows is select_features' to
    // rewrite. What must never happen is a store write nothing in the answer
    // mentions.
    const { store, byName } = mapReady();
    const drawn = await call(byName.draw_shape, { type: "circle", center: "Daan Station" });
    store.setSelection([drawn.drawing_id as string, "osm:node:2"], "agent");
    const out = await call(byName.remove_from_map, { ids: [drawn.drawing_id as string] });

    expect(out.removed).toEqual([{ id: "drawing:1", kind: "drawing", source: "agent" }]);
    expect(store.getDrawings()).toEqual([]);
    expect(store.getSelection()).toEqual(["drawing:1", "osm:node:2"]);
  });

  it("deselects a mark id whose mark is gone, because then it is only a stray", async () => {
    // B3 survives the reorder: an id that names no live mark is exactly the
    // kind of leftover the selection branch exists for, whatever it looks like.
    const { store, byName } = mapReady({ selection: ["drawing:9", "osm:node:2"] });
    const out = await call(byName.remove_from_map, { ids: ["drawing:9"] });

    expect(out.removed).toEqual([{ id: "drawing:9", kind: "selection" }]);
    expect(out.unknown_ids).toEqual([]);
    expect(store.getSelection()).toEqual(["osm:node:2"]);
  });

  it("still deselects a feature the human clicked, because a highlight is not content", async () => {
    // The agent can already replace a human's whole selection with
    // select_features({replace: true}); refusing to take one id out of it while
    // allowing that would be incoherent. Only the marks are protected.
    const { store, byName } = mapReady();
    store.setSelection(["osm:way:10"], "user");
    const out = await call(byName.remove_from_map, { ids: ["osm:way:10"] });
    expect(out.removed).toEqual([{ id: "osm:way:10", kind: "selection", source: "user" }]);
    expect(out.refused).toBeUndefined();
    expect(store.getSelection()).toEqual([]);
  });
});

describe("remove_from_map ids it cannot use", () => {
  it("catches an id that is nearly a mark id instead of calling it an unknown feature", async () => {
    // "drawings:1" and "annotation 2" are what an agent writes from memory. The
    // feature lookup would answer "no such feature" and send it looking in the
    // wrong place for a shape that is right there on the map.
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    const out = await call(byName.remove_from_map, {
      ids: ["drawings:1", "annotation 2", "Drawing:1"],
    });

    expect(out.error).toBeUndefined();
    expect(out.malformed_ids).toEqual(["drawings:1", "annotation 2", "Drawing:1"]);
    expect(out.malformed_count).toBe(3);
    expect(out.unknown_ids).toEqual([]);
    expect(out.not_selected).toBeUndefined();
    // Every form it does accept, so one answer is enough to recover from — and
    // stated once for the call, not repeated beside each id.
    for (const form of ['"drawing:<n>"', '"annotation:<n>"', "osm:node:123"]) {
      expect(out.malformed_error).toContain(form);
    }
    expect(JSON.stringify(out.malformed_ids)).not.toMatch(/drawing:<n>/);
  });

  it("lists the mark ids that do exist when one misses, past the ten map state shows", async () => {
    /*
     * Map state lists the ten most recent notes, so an agent that guessed
     * "annotation:99" cannot enumerate the rest from state alone. Answering
     * with the ids that exist is what turns a wrong guess into one more call
     * instead of a dead end — the same answer find_features gives for a bad
     * `within`.
     */
    const { byName } = mapReady();
    for (let i = 0; i < 12; i++) {
      await call(byName.annotate, { at: "Daan Station", note: `note ${i}` });
    }
    const out = await call(byName.remove_from_map, { ids: ["annotation:99"] });

    expect(out.unknown_ids).toEqual(["annotation:99"]);
    expect(out.known_count).toBe(12);
    expect(out.known_ids).toHaveLength(12);
    expect(out.known_ids).toContain("annotation:12");
    expect(out.state?.annotations.items).toHaveLength(10);
  });

  it("answers a missed drawing id with the drawings, not with the notes", async () => {
    const { byName } = mapReady({
      drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE],
      annotations: [userNote("annotation:1", "mine")],
    });
    const out = await call(byName.remove_from_map, { ids: ["drawing:99"] });
    expect(out.known_ids).toEqual(["drawing:1", "drawing:2"]);
    expect(out.known_count).toBe(2);
  });

  it("shows both vocabularies when one call misses a shape id and a note id", async () => {
    // The kinds share the cap rather than one crowding the other out: an agent
    // that guessed twice needs both lists to recover in one more call. The ids
    // say which kind each is, and known_count is how many marks of those kinds
    // exist in all — the sum, matching neither list on its own.
    const { byName } = mapReady({
      drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE],
      annotations: [userNote("annotation:1", "mine"), userNote("annotation:2", "also mine")],
    });
    const out = await call(byName.remove_from_map, { ids: ["drawing:99", "annotation:99"] });

    expect(out.unknown_ids).toEqual(["drawing:99", "annotation:99"]);
    expect(out.known_ids).toEqual([
      "drawing:1",
      "drawing:2",
      "annotation:1",
      "annotation:2",
    ]);
    expect(out.known_count).toBe(4);
  });

  it("succeeds with an empty removed list rather than failing a batch that removed nothing", async () => {
    // "Nothing matched" is an answer, not a crash: the per-id accounting says
    // why, and the agent can act on it in the same turn.
    const { byName } = mapReady();
    const out = await call(byName.remove_from_map, { ids: ["osm:node:999"] });
    expect(out.error).toBeUndefined();
    expect(out.removed).toEqual([]);
    expect(out.removed_count).toBe(0);
    expect(out.unknown_count).toBe(1);
    expect(out.state).toBeDefined();
  });
});

describe("remove_from_map limits", () => {
  it("caps every list it echoes but reports the true count", async () => {
    // Removing a 25-id selection must not answer with 25 rows; it must also not
    // let the agent believe only 20 ids left the highlight.
    const ids = Array.from({ length: 25 }, (_, i) => `osm:node:${1000 + i}`);
    const { store, byName } = mapReady({ selection: ids });
    const out = await call(byName.remove_from_map, { ids });

    expect(out.removed).toHaveLength(SELECTION_ID_LIMIT);
    expect(out.removed_count).toBe(25);
    expect(store.getSelection()).toEqual([]);

    const missing = Array.from({ length: 30 }, (_, i) => `osm:node:90${i}`);
    const unknown = await call(byName.remove_from_map, { ids: missing });
    expect(unknown.unknown_ids).toHaveLength(SELECTION_ID_LIMIT);
    expect(unknown.unknown_count).toBe(30);
  });

  it("truncates the text it echoes back, the way map state does", async () => {
    // Everything this tool echoes is human or OSM text, and it is echoed on the
    // way out of the map: there is no reason for one removal to bill the agent
    // for a 500-character note.
    const note = "Landlord says the lease starts in March. ".repeat(5).trim();
    const { byName } = mapReady();
    await call(byName.annotate, { at: "Daan Station", note });
    const out = await call(byName.remove_from_map, { ids: ["annotation:1"] });
    expect(out.removed?.[0].note).toHaveLength(NOTE_PREVIEW_CHARS);
    expect(out.removed?.[0].note?.endsWith("…")).toBe(true);
  });

  it("returns no geometry, only ids and the words on them", async () => {
    const { byName } = mapReady({ drawings: [USER_DRAWN_AREA] });
    await call(byName.draw_shape, {
      type: "polygon",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.03],
        [121.54, 25.04],
      ],
    });
    const out = await call(byName.remove_from_map, { ids: ["drawing:2"] });
    expect(JSON.stringify(out)).not.toMatch(/coordinates|geometry|121\.54/);
  });
});

describe("remove_from_map refusals", () => {
  const bad: { input: Record<string, unknown>; error: RegExp }[] = [
    { input: {}, error: /ids/ },
    { input: { ids: [] }, error: /at least one/ },
    { input: { ids: 7 }, error: /array/ },
    { input: { ids: ["drawing:1", null] }, error: /array/ },
    { input: { ids: Array.from({ length: MAX_IDS + 1 }, (_, i) => `x:${i}`) }, error: /at most 100/ },
  ];

  it.each(bad)("refuses $input with the state, like every other write tool", async ({ input, error }) => {
    // A refusal that came back without the map would make the agent read the
    // state again to find out whether anything happened.
    const { store, byName } = mapReady({
      selection: ["osm:node:2"],
      drawings: [USER_DRAWN_AREA],
    });
    const out = await call(byName.remove_from_map, input);
    expect(out.error).toMatch(error);
    expect(out.state).toBeDefined();
    expect(out.removed).toBeUndefined();
    expect(store.getSelection()).toEqual(["osm:node:2"]);
    expect(store.getDrawings()).toHaveLength(1);
  });

  it("points an empty list at the tool that does mean 'clear it'", async () => {
    // select_features({ids: []}) is the documented way to clear a selection.
    // Two tools claiming that verb would make "remove everything" a coin flip.
    const { byName } = mapReady();
    const out = await call(byName.remove_from_map, { ids: [] });
    expect(out.error).toContain("select_features({ids: []})");
  });
});

describe("remove_from_map contract", () => {
  it("is a write tool that echoes human text", async () => {
    const { byName } = mapReady();
    expect(byName.remove_from_map.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.remove_from_map.annotations?.untrustedContentHint).toBe(true);
  });

  it("says in words what no annotation can say: this is permanent, and it deletes no data", async () => {
    // Our WebMCP surface has readOnlyHint and untrustedContentHint and nothing
    // else (`src/types/webmcp.d.ts`): there is no destructiveHint for a client
    // to warn from, so the description is the only place a "there is no undo"
    // can live. The second sentence is the one that stops an agent believing it
    // can delete a park.
    const { description } = createMapTools(createMemoryToolStore()).find(
      (t) => t.name === "remove_from_map",
    )!;
    expect(description).toContain(
      "This never deletes map data. Features and places cannot be removed; naming a selected feature only takes it out of the highlight.",
    );
    expect(description).toMatch(/permanent: there is no undo/);
    expect(description).toMatch(/"drawing:<n>"/);
    expect(description).toMatch(/"annotation:<n>"/);
    expect(description).toMatch(/source "user"/);
  });
});
