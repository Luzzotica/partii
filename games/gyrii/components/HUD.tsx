"use client";

import { useEffect, useState } from "react";
import { useGyriiStore } from "../store/gameStore";
import {
  PHOTON_RIFLE_RECHARGE_MS,
  HEALTH_SCALE,
  MAX_HEALTH,
} from "../game/constants";

export default function HUD() {
  const {
    localPlayer,
    killFeed,
    currentLobby,
    mousePosition,
    weaponChargeProgress,
    photonRifleRechargeUntil,
  } = useGyriiStore();

  const [now, setNow] = useState(() => performance.now());
  const isPhotonRifle = localPlayer?.weapon === "photonRifle";
  const isRecharging =
    isPhotonRifle &&
    photonRifleRechargeUntil > 0 &&
    performance.now() < photonRifleRechargeUntil;

  useEffect(() => {
    if (!isRecharging) return;
    const id = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(id);
  }, [isRecharging, photonRifleRechargeUntil]);

  if (!localPlayer) return null;

  const healthPercent = (localPlayer.health / MAX_HEALTH) * 100;
  const healthColor =
    healthPercent > 60 ? "cyan" : healthPercent > 30 ? "yellow" : "red";

  const rechargeProgress =
    isRecharging && photonRifleRechargeUntil > now
      ? Math.min(
          1,
          Math.max(
            0,
            1 - (photonRifleRechargeUntil - now) / PHOTON_RIFLE_RECHARGE_MS,
          ),
        )
      : 1;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Health Bar */}
      <div className="absolute bottom-8 left-8 pointer-events-auto">
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-cyan-500/30">
          <div className="text-xs text-gray-400 mb-1">HEALTH</div>
          <div className="w-48 h-4 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full transition-[width] duration-100 ease-out"
              style={{
                width: `${healthPercent}%`,
                backgroundColor:
                  healthColor === "cyan"
                    ? "#00ffff"
                    : healthColor === "yellow"
                      ? "#ffff00"
                      : "#ff4444",
                boxShadow: `0 0 10px ${healthColor === "cyan" ? "#00ffff" : healthColor === "yellow" ? "#ffff00" : "#ff4444"}`,
              }}
            />
          </div>
          <div
            className="text-2xl font-bold mt-1"
            style={{
              color:
                healthColor === "cyan"
                  ? "#00ffff"
                  : healthColor === "yellow"
                    ? "#ffff00"
                    : "#ff4444",
            }}
          >
            {(localPlayer.health / HEALTH_SCALE).toFixed(1)}
          </div>
        </div>
      </div>

      {/* Weapon charge (e.g. photon rifle) or recharge cooldown - centered */}
      {(weaponChargeProgress > 0 || (isPhotonRifle && isRecharging)) && (
        <div className="absolute left-1/2 bottom-8 -translate-x-1/2 pointer-events-auto">
          <div className="bg-black/50 backdrop-blur-sm rounded-lg p-2 border border-cyan-500/30">
            <div className="text-xs text-cyan-400 mb-1">
              {isRecharging ? "RECHARGE" : "CHARGE"}
            </div>
            <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  isRecharging ? "bg-cyan-500/60" : "bg-cyan-500"
                }`}
                style={{
                  width: `${
                    isRecharging
                      ? Math.min(100, Math.max(0, rechargeProgress * 100))
                      : Math.min(100, weaponChargeProgress * 100)
                  }%`,
                  boxShadow: "0 0 8px #00ffff",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Throwables */}
      <div className="absolute bottom-8 right-8 pointer-events-auto">
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-pink-500/30">
          <div className="flex gap-2">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-full bg-green-500" />
              <span className="text-green-400 text-sm">
                {localPlayer.grenadeCount}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-full bg-orange-500" />
              <span className="text-orange-400 text-sm">
                {localPlayer.molotovCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Kill Feed */}
      <div className="absolute top-8 right-8">
        <div className="space-y-2">
          {killFeed.map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className="bg-black/50 backdrop-blur-sm rounded px-3 py-2 border border-white/10 animate-fade-in"
            >
              <span className="text-cyan-400">{event.killerName}</span>
              <span className="text-gray-400 mx-2">[{event.weapon}]</span>
              <span className="text-pink-400">{event.victimName}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scoreboard */}
      <div className="absolute top-8 left-8">
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-3 border border-purple-500/30">
          <div className="text-xs text-gray-400 mb-2">SCORE</div>
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-cyan-400">KILLS</div>
              <div className="text-2xl font-bold text-cyan-300">
                {localPlayer.kills}
              </div>
            </div>
            <div>
              <div className="text-xs text-pink-400">DEATHS</div>
              <div className="text-2xl font-bold text-pink-300">
                {localPlayer.deaths}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Crosshair - at mouse position */}
      <div
        className="fixed pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ left: mousePosition.x, top: mousePosition.y }}
      >
        <div className="relative w-8 h-8">
          <div className="absolute top-0 left-1/2 w-0.5 h-2 bg-white/80 -translate-x-1/2" />
          <div className="absolute bottom-0 left-1/2 w-0.5 h-2 bg-white/80 -translate-x-1/2" />
          <div className="absolute left-0 top-1/2 w-2 h-0.5 bg-white/80 -translate-y-1/2" />
          <div className="absolute right-0 top-1/2 w-2 h-0.5 bg-white/80 -translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full bg-cyan-400 -translate-x-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Controls hint - hidden for now; can be moved to settings or help menu */}
      {false && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
          <div className="bg-black/30 backdrop-blur-sm rounded-lg px-4 py-2 text-xs text-gray-400">
            WASD - Move | Mouse - Aim | LMB - Shoot | RMB - Grenade | MMB -
            Molotov | Q - Secondary
          </div>
        </div>
      )}
    </div>
  );
}
