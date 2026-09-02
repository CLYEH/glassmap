import { beforeEach, describe, expect, it } from "vitest";
import { useMapStore } from "@/lib/store/map-store";
import { useNoteStore } from "./note-store";

const note = () => useNoteStore.getState();

describe("note store", () => {
  beforeEach(() => {
    useNoteStore.setState({ open: false, draft: null });
  });

  it("keeps an unplaced note out of the map store entirely", () => {
    // The line this store exists to draw: a draft has no id, is on no map and
    // is not something `get_map_state` may report. Only `addAnnotation` — the
    // form's own submit — crosses it.
    const before = useMapStore.getState();
    note().setOpen(true);
    note().place([121.5, 25]);

    expect(useMapStore.getState().annotations).toBe(before.annotations);
    expect(useMapStore.getState().activity).toBe(before.activity);
  });

  it("rounds the clicked place to ~1 m, like a drawn corner", () => {
    // The pin the map draws, the coordinates the form reports and the
    // annotation the store ends up with have to be the same number.
    note().setOpen(true);
    note().place([121.5175123456, 25.0478987654]);
    expect(note().draft).toEqual([121.51751, 25.0479]);
  });

  it("moves the pin on a second click rather than collecting places", () => {
    // One note, one place: unlike a polygon, a second click is a correction.
    note().setOpen(true);
    note().place([121.5, 25]);
    note().place([121.6, 25.1]);
    expect(note().draft).toEqual([121.6, 25.1]);
  });

  it("throws the draft away when the popover is toggled either way", () => {
    // Closing the popover abandons the note being written, so the pin must go
    // with it; re-opening starts at "centre" rather than at a place the person
    // clicked in a session they left.
    note().setOpen(true);
    note().place([121.5, 25]);
    note().setOpen(false);
    expect(note().draft).toBeNull();

    note().setOpen(true);
    note().place([121.5, 25]);
    note().setOpen(true);
    expect(note().draft).toBeNull();
  });

  it("clears the draft after the note is pinned", () => {
    // The next note starts unplaced: leaving the old draft behind would pin it
    // silently at the place of the note before it.
    note().setOpen(true);
    note().place([121.5, 25]);
    note().clearDraft();
    expect(note().draft).toBeNull();
    expect(note().open).toBe(true);
  });
});
