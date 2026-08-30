"use client";

import { useMapStore } from "@/lib/store/map-store";
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
 */
export function WebMcpBadge() {
  const info = useMapStore((s) => s.webmcp);
  const mode = useAwakenMode();
  const surfaces = info?.surfaces ?? [];
  const live = surfaces.length > 0;
  const tools = `${info?.toolCount ?? 0} tools`;
  const where = live ? surfaces.map((s) => SHORT_SURFACE[s] ?? s).join(" · ") : "none";

  if (mode === "idle") {
    return (
      <span data-testid="webmcp-status" className="gm-machine">
        {`WebMCP ${info === null ? "…" : live ? "live" : "off"} · ${tools} · ${where}`}
      </span>
    );
  }

  return (
    <div className={`badge lg wake${live ? "" : " offline"}`} data-testid="webmcp-status">
      <span aria-hidden className="live-dot" />
      <span className="badge-label">{live ? "Agent connected" : "WebMCP off"}</span>
      {/* The protocol rides with the count rather than with the surface list:
          below 1361px there is no room for the surface, and "12 tools" with no
          word for what is reading them is a number about nothing. */}
      <span className="badge-tools">{live ? `${tools} · WebMCP` : tools}</span>
      <span className="badge-surface">{where}</span>
    </div>
  );
}
