"use client";

import dynamic from "next/dynamic";
import { StateOverlay } from "@/components/StateOverlay";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

export default function Home() {
  useFeatureData();
  return (
    <main data-testid="map-page" className="relative flex-1 overflow-hidden">
      <MapCanvas />
      <StateOverlay />
    </main>
  );
}
