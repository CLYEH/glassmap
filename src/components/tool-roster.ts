/**
 * Every tool this page declares, in the order the landing pitch lists them:
 * the twelve imperative registrations first, then the declarative `add_note`
 * form (`AddNoteForm.tsx`), which a WebMCP browser picks up from the markup
 * with no JavaScript registration at all.
 *
 * `tool-roster.test.ts` fails if this list and the tool layer ever disagree,
 * because the landing screen is the first thing a judge reads: advertising a
 * tool the page does not have would be the one lie the whole design is against.
 *
 * The *count* shown in the WebMCP badge is not taken from here — it is counted
 * at runtime from the registration result plus the forms present in the DOM
 * (see `WebMcpProvider.tsx`).
 */
export const IMPERATIVE_TOOLS = [
  "get_map_state",
  "set_map_view",
  "list_features_in_view",
  "find_features",
  "select_features",
  "draw_shape",
  "annotate",
  "remove_from_map",
  "describe_surroundings",
  "compare_areas",
  "measure",
  "get_share_link",
] as const;

/** Declared by markup, not by script: `<form toolname="add_note">`. */
export const DECLARATIVE_TOOLS = ["add_note"] as const;

export const TOOL_ROSTER: readonly string[] = [...IMPERATIVE_TOOLS, ...DECLARATIVE_TOOLS];
