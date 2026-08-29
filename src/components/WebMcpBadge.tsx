"use client";

import { useMapStore } from "@/lib/store/map-store";

/** "document.modelContext" is the wire name; the badge has room for the noun. */
const SHORT_SURFACE: Record<string, string> = {
  "document.modelContext": "document",
  "navigator.modelContext": "navigator",
  shim: "shim",
};

/**
 * Proof that the page is agent-readable right now: which WebMCP surface picked
 * the tools up, and how many tools it declares. Registration itself happens in
 * `WebMcpProvider`, which writes the result to the store — this is the part of
 * it a person can see, and it lives in the bottom bar so it cannot collide with
 * the legend (they are two ends of one flex row).
 *
 * The count is `WebMcpProvider`'s: imperative registrations plus the
 * declarative `<form toolname>` tools present in the page.
 */
export function WebMcpBadge() {
  const info = useMapStore((s) => s.webmcp);
  const surfaces = info?.surfaces ?? [];
  const live = surfaces.length > 0;

  return (
    <div className={`badge glass${live ? "" : " offline"}`} data-testid="webmcp-status">
      <span aria-hidden className="live-dot" />
      <span className="badge-label">WebMCP {info === null ? "…" : live ? "live" : "off"}</span>
      <span className="badge-tools">{info?.toolCount ?? 0} tools</span>
      <span className="badge-surface">
        {live ? surfaces.map((s) => SHORT_SURFACE[s] ?? s).join(" · ") : "none"}
      </span>
    </div>
  );
}
