"use client";

import { Suspense } from "react";
import CustomMapsPage from "@/games/gyrii/components/CustomMapsPage";

export default function MapsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="text-cyan-400">Loading...</div>
        </div>
      }
    >
      <CustomMapsPage />
    </Suspense>
  );
}
