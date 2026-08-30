"use client";

import { useMapStore } from "@/lib/store/map-store";
import { BADGE_LABEL, badgeClaim } from "./badge-claim";
import { useAwakenMode } from "./useAwakenMode";

/** "document.modelContext" is the wire name; the badge has room for the noun. */
const SHORT_SURFACE: Record<string, string> = {
  "document.modelContext": "document",
  "navigator.modelContext": "navigator",
  shim: "shim",
};

/**
 * Proof that an agent is here: the live dot, the tool count and the surface
 * that picked them up. Registration itself happens in `WebMcpProvider`, which
 * writes the result to the store — this is the part of it a person can see.
 *
 * **It is not on the landing page.** A badge announcing WebMCP to somebody who
 * came to look at a map is exactly the hackathon-showcase framing the
 * repositioning removed (BRIEF item 3): the page is agent-*readable* from the
 * first paint, and the honest way to say so to a human is the corner whisper,
 * not a status light. The moment an agent acts, this replaces the whisper and
 * says who arrived.
 *
 * Hidden, not deleted. The element stays in the DOM in the machine-mirror
 * class (`.gm-machine`, off screen — the same convention `map-status` and the
 * state overlay use), because "did registration succeed, on which surface,
 * with how many tools" is the one fact about this page that has to be readable
 * without an agent and without pixels. `webmcp-status` therefore answers in
 * both chromes, which is what keeps the WebMCP contract testable at landing.
 *
 * ## "Agent connected" is a claim, and it has a price
 *
 * A restored link wears the agent chrome without an agent: `restoredAgentState`
 * says somebody's agent worked on this map *before the link was sent*, and
 * nothing at all says one is here now (`lib/awaken/index.ts` — that is exactly
 * why a restored page gets no arrival story). The feed already knows this: its
 * "live" pulse holds still and its Listening row is withheld until the first
 * real call. The corner said "Agent connected" through all of it, over a page
 * with zero calls, and it was the loudest of the three.
 *
 * So the label is gated on the same fact the rest of the restored chrome is
 * gated on. Until this page has seen a call of its own it says
 * **"Agent-readable"** — which is registration-true, and the only thing the
 * page can prove: the tools are declared, on a real surface, and the count
 * beside it is the count. The dot goes hollow and stops pulsing, the same
 * vocabulary the restored feed row uses for "this did not happen here"
 * (`.call.restored-sum .dot`, `.feed[data-restored] .pulse`). The first live
 * call fills it in and the label becomes "Agent connected" — the moment the
 * claim becomes true is the moment it is made.
 */
export function WebMcpBadge() {
  const info = useMapStore((s) => s.webmcp);
  // The count, not the array: the label only changes between none and some,
  // so this does not re-render the corner on every call.
  const calls = useMapStore((s) => s.activity.length);
  const mode = useAwakenMode();
  const surfaces = info?.surfaces ?? [];
  const live = surfaces.length > 0;
  const tools = `${info?.toolCount ?? 0} tools`;
  const where = live ? surfaces.map((s) => SHORT_SURFACE[s] ?? s).join(" · ") : "none";
  const claim = badgeClaim({ surfaces, calls });
  const tone = claim === "off" ? " offline" : claim === "readable" ? " ready" : "";

  if (mode === "idle") {
    return (
      <span data-testid="webmcp-status" className="gm-machine">
        {`WebMCP ${info === null ? "…" : live ? "live" : "off"} · ${tools} · ${where}`}
      </span>
    );
  }

  return (
    <div className={`badge lg wake${tone}`} data-testid="webmcp-status">
      <span aria-hidden className="live-dot" />
      <span className="badge-label">{BADGE_LABEL[claim]}</span>
      {/* The protocol rides with the count rather than with the surface list:
          below 1361px there is no room for the surface, and "12 tools" with no
          word for what is reading them is a number about nothing. */}
      <span className="badge-tools">{live ? `${tools} · WebMCP` : tools}</span>
      <span className="badge-surface">{where}</span>
    </div>
  );
}
