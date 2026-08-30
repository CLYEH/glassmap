/**
 * What the corner badge is allowed to claim about who is reading this page.
 *
 * Pure, and its own file, because it is the one sentence in the app that can
 * lie the loudest. The agent chrome is worn by two very different pages:
 *
 *  - one where an agent called a tool here, a moment ago (`activity`), and
 *  - one restored from somebody else's link (`restoredAgentState`, which is
 *    what put it in this chrome), carrying agent *work* and no agent — that is
 *    exactly why `lib/awaken/`
 *    gives it the end state with no arrival story, why the feed's live pulse
 *    holds still on it and why its Listening row is withheld.
 *
 * The badge used to say "Agent connected" on both. On the second it was a
 * claim about a party that is not there, over a feed that says zero calls, and
 * it is the only surface on that page that made it.
 *
 * So there are three answers, and each is exactly what the page can prove:
 *
 *  - `connected` — a call happened here. The only state that may say so.
 *  - `readable` — the tools registered on a real surface and nothing has come
 *    through them. Registration-true, and all a restored page knows.
 *  - `off` — registration found no surface at all.
 *
 * The first live call moves a restored page from `readable` to `connected`,
 * which is the moment the stronger claim becomes true.
 */
export type BadgeClaim = "connected" | "readable" | "off";

/** The slice of the store the claim is computed from. */
export interface BadgeClaimState {
  /** Registration's answer: the surfaces the tools actually went onto. */
  surfaces: readonly string[];
  /**
   * How many calls this page has recorded. An agent acted **here** — only
   * `recordActivity` writes `activity`, from the tool instrumentation and the
   * agent-submitted note form (`lib/awaken/index.ts`). A restored link never
   * touches it, which is the whole of the rule below.
   */
  calls: number;
}

/**
 * Written as "connected requires a call", not as "readable when restored": the
 * restored page is the case this exists for, but a rule phrased around it
 * would still say "connected" on any *other* page that reached the agent
 * chrome without one. There is no such page today; there is no version of this
 * that lies if one appears.
 */
export function badgeClaim(state: BadgeClaimState): BadgeClaim {
  if (state.surfaces.length === 0) return "off";
  return state.calls > 0 ? "connected" : "readable";
}

/**
 * The words. "Agent-readable" is the repositioning's own phrase for what this
 * page is before anybody uses it (README, the corner whisper), which is why it
 * is the honest label here too rather than a hedged "Agent connected".
 */
export const BADGE_LABEL: Record<BadgeClaim, string> = {
  connected: "Agent connected",
  readable: "Agent-readable",
  off: "WebMCP off",
};
