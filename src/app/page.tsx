"use client";

import dynamic from "next/dynamic";
import { DrawToolbar } from "@/components/DrawToolbar";
import { StateOverlay } from "@/components/StateOverlay";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

export default function Home() {
  useFeatureData();
  return (
    <main
      data-testid="map-page"
      className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <MapCanvas />
        <StateOverlay />
        <DrawToolbar />
      </div>
    </main>
  );
}
