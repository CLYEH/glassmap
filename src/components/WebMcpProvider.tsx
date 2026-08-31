"use client";

import { useEffect } from "react";
import { registerTools } from "@/lib/webmcp/register";
import { createMapTools } from "@/lib/map-tools";
import { useMapStore, zustandToolStore } from "@/lib/store/map-store";

/**
 * How many tools this page declares to a WebMCP client, counted rather than
 * written down: the imperative registrations, plus every `<form toolname>` in
 * the document.
 *
 * The declarative forms are real tools — a WebMCP browser picks `add_note` up
 * from `AddNoteForm.tsx` with no JavaScript registration at all — so a badge
 * that counted only `registerTools` would under-report the page. Counting the
 * DOM keeps the badge honest in both directions: delete the form and the
 * number falls by itself.
 */
function declaredToolCount(registered: number): number {
  return registered + document.querySelectorAll("form[toolname]").length;
}

/**
 * Registers the GlassMap tools once on mount and records which WebMCP surface
 * picked them up. `?shim=1` forces the dev shim even in production builds.
 *
 * The visible badge is `WebMcpBadge`, in the bottom bar, reading the same store
 * field — the design puts it in the corridor along the foot of the map, which
 * is a different part of the tree from this provider.
 */
export function WebMcpProvider({ children }: { children: React.ReactNode }) {
  const setWebMcp = useMapStore((s) => s.setWebMcp);

  useEffect(() => {
    const forceShim = new URLSearchParams(window.location.search).get("shim") === "1";
    const reg = registerTools(createMapTools(zustandToolStore), {
      allowShim: forceShim || process.env.NODE_ENV !== "production",
    });
    setWebMcp({
      surfaces: reg.surfaces,
      toolCount: declaredToolCount(reg.toolNames.length),
    });
    return () => {
      reg.unregister();
      setWebMcp(null);
    };
  }, [setWebMcp]);

  return <>{children}</>;
}
