"use client";

import dynamic from "next/dynamic";
import { DrawToolbar } from "@/components/DrawToolbar";
import { ShareStatus } from "@/components/ShareStatus";
import { Sidebar } from "@/components/Sidebar";
import { StateOverlay } from "@/components/StateOverlay";
import { useDevStoreHandle } from "@/components/dev-store-handle";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

export default function Home() {
  useFeatureData();
  useDevStoreHandle();
  return (
    // A row on wide windows, a column on narrow ones. The sidebar is part of
    // the layout rather than an overlay, so it never covers the map.
    <main
      data-testid="map-page"
      className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Before <MapCanvas /> on purpose: sibling effects run in tree order,
            so a shared link is in the store before the map reads its opening
            camera out of it, and the map opens there rather than flying there. */}
        <ShareStatus />
        <MapCanvas />
        <StateOverlay />
        <DrawToolbar />
      </div>
      <Sidebar />
    </main>
  );
}
