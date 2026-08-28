"use client";

import { useEffect } from "react";
import { registerTools } from "@/lib/webmcp/register";
import { createMapTools } from "@/lib/map-tools";
import { useMapStore, zustandToolStore } from "@/lib/store/map-store";

/**
 * Registers the GlassMap tools once on mount and shows which WebMCP surface
 * picked them up. `?shim=1` forces the dev shim even in production builds.
 */
export function WebMcpProvider({ children }: { children: React.ReactNode }) {
  const info = useMapStore((s) => s.webmcp);
  const setWebMcp = useMapStore((s) => s.setWebMcp);

  useEffect(() => {
    const forceShim = new URLSearchParams(window.location.search).get("shim") === "1";
    const reg = registerTools(createMapTools(zustandToolStore), {
      allowShim: forceShim || process.env.NODE_ENV !== "production",
    });
    setWebMcp({ surfaces: reg.surfaces, toolCount: reg.toolNames.length });
    return () => {
      reg.unregister();
      setWebMcp(null);
    };
  }, [setWebMcp]);

  return (
    <>
      {children}
      <div
        data-testid="webmcp-status"
        className="fixed bottom-2 right-2 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white"
      >
        WebMCP:{" "}
        {info === null ? "…" : info.surfaces.length ? info.surfaces.join(" + ") : "none"} ·{" "}
        {info?.toolCount ?? 0} tools
      </div>
    </>
  );
}
