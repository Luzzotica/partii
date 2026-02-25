"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth-context";
import type { MapData } from "../game/maps/MapLoader";
import { maps as builtInMaps } from "../game/maps";
import MinimapPreview from "./MinimapPreview";

const BUILTIN_MAP_ENTRIES: { id: string; name: string; description: string }[] =
  [
    {
      id: "arena",
      name: "Arena",
      description: "Open arena with corner pillars",
    },
    { id: "maze", name: "Maze", description: "Labyrinthine corridors" },
    {
      id: "warehouse",
      name: "Warehouse",
      description: "Industrial shelving and crates",
    },
  ];

type CustomMapMeta = {
  id: string;
  creatorId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type MapWithData = CustomMapMeta & { mapData?: MapData };

export default function CustomMapsPage() {
  const { user } = useAuth();
  const [maps, setMaps] = useState<MapWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicatingBuiltinId, setDuplicatingBuiltinId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setMaps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch("/api/gyrii/maps")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load maps");
        return r.json();
      })
      .then((data) => setMaps((data.maps ?? []) as MapWithData[]))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [user]);

  const handleDuplicate = async (map: MapWithData) => {
    if (!user) return;
    setDuplicatingId(map.id);
    try {
      const res = await fetch(`/api/gyrii/maps/${map.id}`);
      if (!res.ok) throw new Error("Failed to load map");
      const mapData = (await res.json()) as MapData;
      const copyName = `Copy of ${map.name}`.slice(0, 100);
      const createRes = await fetch("/api/gyrii/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: copyName,
          description: map.description ?? "",
          mapJson: { ...mapData, name: copyName },
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to duplicate");
      }
      const { id } = await createRes.json();
      window.location.href = `/arcade/gyrii/editor?edit=${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate");
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDuplicateBuiltin = async (builtinId: string) => {
    if (!user) return;
    const mapData = builtInMaps[builtinId];
    if (!mapData) return;
    const entry = BUILTIN_MAP_ENTRIES.find((e) => e.id === builtinId);
    const copyName = `Copy of ${entry?.name ?? builtinId}`.slice(0, 100);
    setDuplicatingBuiltinId(builtinId);
    setError(null);
    try {
      const res = await fetch("/api/gyrii/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: copyName,
          description: entry?.description ?? "",
          mapJson: { ...mapData, name: copyName },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to duplicate");
      }
      const { id } = await res.json();
      window.location.href = `/arcade/gyrii/editor?edit=${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate");
    } finally {
      setDuplicatingBuiltinId(null);
    }
  };

  const loadMapForPreview = async (map: MapWithData) => {
    if (map.mapData) return;
    try {
      const res = await fetch(`/api/gyrii/maps/${map.id}`);
      if (!res.ok) return;
      const mapData = (await res.json()) as MapData;
      setMaps((prev) =>
        prev.map((m) => (m.id === map.id ? { ...m, mapData } : m)),
      );
    } catch {
      // ignore
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen bg-gray-950 text-gray-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <Link
              href="/arcade/gyrii"
              className="text-cyan-400 hover:text-cyan-300 text-sm"
            >
              ← Back to Gyrii
            </Link>
          </div>
          <div className="bg-gray-900/80 rounded-lg p-8 border border-gray-700 text-center">
            <h1 className="text-2xl font-bold text-cyan-400 mb-2">
              Custom Maps
            </h1>
            <p className="text-gray-400 mb-4">
              Sign in to create and manage your custom maps.
            </p>
            <Link
              href="/arcade/gyrii"
              className="inline-block py-2 px-4 bg-cyan-600 hover:bg-cyan-500 rounded font-semibold"
            >
              Back to Gyrii
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Link
            href="/arcade/gyrii"
            className="text-cyan-400 hover:text-cyan-300 text-sm"
          >
            ← Back to Gyrii
          </Link>
          <div className="flex gap-3 items-center">
            <h1 className="text-2xl font-bold text-cyan-400">My Maps</h1>
            <Link
              href="/arcade/gyrii/editor"
              className="py-2 px-4 bg-cyan-600 hover:bg-cyan-500 rounded font-semibold text-sm"
            >
              Start from scratch
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Starter maps - always available to duplicate */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Duplicate a starter map
          </h2>
          <div className="flex flex-wrap gap-3">
            {BUILTIN_MAP_ENTRIES.map((entry) => {
              const mapData = builtInMaps[entry.id];
              if (!mapData) return null;
              const isDuplicating = duplicatingBuiltinId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="w-[120px] shrink-0 bg-gray-900/80 rounded-lg border border-gray-700 overflow-hidden flex flex-col"
                >
                  <div className="h-20 bg-gray-800 flex items-center justify-center shrink-0">
                    <MinimapPreview
                      mapData={mapData}
                      size={80}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="p-2 flex-1 flex flex-col min-w-0">
                    <div className="font-semibold text-white text-sm truncate">
                      {entry.name}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {entry.description}
                    </div>
                    <button
                      onClick={() => handleDuplicateBuiltin(entry.id)}
                      disabled={!!duplicatingBuiltinId}
                      className="mt-2 w-full py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-[10px] font-medium"
                    >
                      {isDuplicating ? "..." : "Duplicate"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Your custom maps */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Your maps & public maps
          </h2>
          {loading ? (
            <div className="text-gray-400 py-8">Loading maps...</div>
          ) : maps.length === 0 ? (
            <div className="bg-gray-900/80 rounded-lg p-6 border border-gray-700 text-center">
              <p className="text-gray-400 text-sm">
                No custom maps yet. Duplicate a starter map above or start from
                scratch.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {maps.map((map) => (
                <div
                  key={map.id}
                  className="w-[120px] shrink-0 bg-gray-900/80 rounded-lg border border-gray-700 overflow-hidden flex flex-col"
                >
                  <div
                    className="h-20 bg-gray-800 flex items-center justify-center cursor-pointer shrink-0"
                    onClick={() => loadMapForPreview(map)}
                    onMouseEnter={() => loadMapForPreview(map)}
                  >
                    {map.mapData ? (
                      <MinimapPreview
                        mapData={map.mapData}
                        size={80}
                        className="w-full h-full"
                      />
                    ) : (
                      <span className="text-gray-500 text-xs">
                        Hover to preview
                      </span>
                    )}
                  </div>
                  <div className="p-2 flex-1 flex flex-col min-w-0">
                    <div className="font-semibold text-white text-sm truncate">
                      {map.name}
                    </div>
                    {map.description && (
                      <div className="text-[10px] text-gray-400 truncate">
                        {map.description}
                      </div>
                    )}
                    <div className="text-[9px] text-gray-500 mt-0.5">
                      {map.isPublic ? "Public" : "Private"}
                      {map.creatorId !== user?.id ? " • By others" : ""}
                    </div>
                    <div className="flex gap-1 mt-2">
                      {map.creatorId === user?.id && (
                        <Link
                          href={`/arcade/gyrii/editor?edit=${map.id}`}
                          className="flex-1 py-1 text-center bg-cyan-600 hover:bg-cyan-500 rounded text-[10px] font-medium"
                        >
                          Edit
                        </Link>
                      )}
                      <button
                        onClick={() => handleDuplicate(map)}
                        disabled={!!duplicatingId}
                        className="flex-1 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-[10px] font-medium"
                      >
                        {duplicatingId === map.id ? "..." : "Duplicate"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
