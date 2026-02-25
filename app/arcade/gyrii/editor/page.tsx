"use client";

import { Suspense } from "react";
import MapEditor from "@/games/gyrii/components/MapEditor";

export default function MapEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="text-cyan-400">Loading editor...</div>
        </div>
      }
    >
      <MapEditor />
    </Suspense>
  );
}
