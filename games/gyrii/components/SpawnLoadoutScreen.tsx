"use client";

import { useState, useEffect } from "react";
import { useGyriiStore } from "../store/gameStore";
import { useSpacetimeDB } from "../hooks/useSpacetimeDB";
import type { WeaponType, SecondaryType } from "../store/gameStore";

const PRIMARY_OPTIONS: { value: WeaponType; label: string }[] = [
  { value: "dualMachineGun", label: "Machine Gun" },
  { value: "photonRifle", label: "Ray Gun" },
];

export default function SpawnLoadoutScreen() {
  const localPlayer = useGyriiStore((s) => s.localPlayer);

  const [primary, setPrimary] = useState<WeaponType>("dualMachineGun");
  const [secondary, setSecondary] = useState<SecondaryType>("popupKnives");
  const [isSpawning, setIsSpawning] = useState(false);
  const { leaveLobby, requestSpawn } = useSpacetimeDB();
  const { setCurrentLobby, setPendingLeaveLobby } = useGyriiStore();

  // When respawning, pre-fill with the loadout the player had when they died
  useEffect(() => {
    if (localPlayer) {
      setPrimary(localPlayer.weapon);
      setSecondary(localPlayer.secondary);
    } else {
      setPrimary("dualMachineGun");
      setSecondary("popupKnives");
    }
  }, [
    localPlayer?.id,
    localPlayer?.isAlive,
    localPlayer?.weapon,
    localPlayer?.secondary,
  ]);

  const onSpawn = async () => {
    setIsSpawning(true);
    try {
      await requestSpawn(primary, secondary);
    } catch (e) {
      console.error("Spawn failed:", e);
    } finally {
      setIsSpawning(false);
    }
  };

  const onLeave = async () => {
    setPendingLeaveLobby(true);
    setCurrentLobby(null);
    await leaveLobby();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-gray-900/95 border border-cyan-500/30 rounded-lg p-8 max-w-md w-full mx-4">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500 mb-2 text-center">
          Choose Loadout
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Pick your weapons, then spawn into the arena
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-cyan-400 mb-2">
              Primary weapon
            </label>
            <div className="flex gap-2 flex-wrap">
              {PRIMARY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrimary(opt.value)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    primary === opt.value
                      ? "bg-cyan-500 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={onSpawn}
            disabled={isSpawning}
            className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-pink-500 text-white font-bold rounded-lg hover:from-cyan-400 hover:to-pink-400 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
          >
            {isSpawning ? "Spawning…" : "Spawn"}
          </button>

          <button
            onClick={onLeave}
            className="w-full py-3 px-6 bg-gray-700 text-white font-bold rounded-lg hover:bg-gray-600 transition-all duration-200"
          >
            Leave lobby
          </button>
        </div>
      </div>
    </div>
  );
}
