"use client";

import { useEffect, useState } from "react";
import { useGyriiStore } from "../store/gameStore";
import {
  PHOTON_RIFLE_RECHARGE_MS,
  HEALTH_SCALE,
  MAX_HEALTH,
  POPUP_HAMMERS_COOLDOWN_MICROS,
  DASH_COOLDOWN_MICROS,
  TEAM_COLORS,
  teamColorToHex,
} from "../game/constants";
import GameMinimap from "./GameMinimap";

export default function HUD() {
  const {
    localPlayer,
    players,
    killFeed,
    currentLobby,
    mousePosition,
    weaponChargeProgress,
    photonRifleRechargeUntil,
  } = useGyriiStore();

  const [now, setNow] = useState(() => performance.now());
  const isPhotonRifle = localPlayer?.weapon === "photonRifle";
  const grenadeCooldownMicros = 1_000_000; // 1 second
  const nowMicros = Date.now() * 1000;

  const secondaryForcedCooldownUntilMicros = Number(
    localPlayer?.secondaryForcedCooldownUntilMicros ?? 0,
  );
  const secondaryCooldownDurationMicros =
    localPlayer?.secondary === "popupHammers"
      ? POPUP_HAMMERS_COOLDOWN_MICROS
      : localPlayer?.secondary === "dash"
        ? DASH_COOLDOWN_MICROS
        : POPUP_HAMMERS_COOLDOWN_MICROS;
  const isSecondaryOnCooldown =
    (localPlayer?.secondary === "popupHammers" ||
      localPlayer?.secondary === "dash") &&
    secondaryForcedCooldownUntilMicros > 0 &&
    nowMicros < secondaryForcedCooldownUntilMicros;
  const secondaryCooldownRemaining = isSecondaryOnCooldown
    ? Math.max(0, (secondaryForcedCooldownUntilMicros - nowMicros) / 1000)
    : 0;
  const secondaryCooldownProgress =
    isSecondaryOnCooldown && secondaryCooldownDurationMicros > 0
      ? Math.min(
          1,
          Math.max(
            0,
            (nowMicros -
              (secondaryForcedCooldownUntilMicros -
                secondaryCooldownDurationMicros)) /
              secondaryCooldownDurationMicros,
          ),
        )
      : 1;
  const lastGrenadeThrownAt = Number(localPlayer?.lastGrenadeThrownAt ?? 0);
  const elapsedMicros = nowMicros - lastGrenadeThrownAt;
  const grenadeCooldownRemaining = Math.max(
    0,
    (grenadeCooldownMicros - elapsedMicros) / 1000,
  );
  const isGrenadeOnCooldown = grenadeCooldownRemaining > 0;
  const grenadeCooldownProgress = Math.min(
    1,
    elapsedMicros / grenadeCooldownMicros,
  );
  const isRecharging =
    isPhotonRifle &&
    photonRifleRechargeUntil > 0 &&
    performance.now() < photonRifleRechargeUntil;

  useEffect(() => {
    if (!isRecharging && !isGrenadeOnCooldown && !isSecondaryOnCooldown) return;
    const id = setInterval(() => setNow(performance.now()), 16);
    return () => clearInterval(id);
  }, [
    isRecharging,
    isGrenadeOnCooldown,
    isSecondaryOnCooldown,
    photonRifleRechargeUntil,
    lastGrenadeThrownAt,
    secondaryForcedCooldownUntilMicros,
  ]);

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
      {/* Health + Ammo - right side, stacked */}
      <div className="absolute bottom-8 right-8 pointer-events-auto flex flex-col gap-3">
        {/* Health Bar - vertical */}
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-2 border border-cyan-500/30 self-end">
          <div className="w-5 h-32 bg-gray-800 rounded-full overflow-hidden flex flex-col justify-end">
            <div
              className="w-full rounded-full"
              style={{
                height: `${healthPercent}%`,
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
        </div>
        {/* Throwables (ammo) */}
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-pink-500/30 self-end">
          <div className="flex gap-2 justify-end">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <div
                  className={`w-4 h-4 rounded-full ${
                    isGrenadeOnCooldown ? "bg-gray-600" : "bg-green-500"
                  }`}
                />
                <span
                  className={`text-sm ${
                    isGrenadeOnCooldown ? "text-gray-500" : "text-green-400"
                  }`}
                >
                  {localPlayer.grenadeCount}
                </span>
              </div>
              {isGrenadeOnCooldown && (
                <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500/70 transition-all duration-75"
                    style={{ width: `${grenadeCooldownProgress * 100}%` }}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs text-pink-400">
                  {localPlayer.secondary === "popupHammers"
                    ? "Hammers"
                    : localPlayer.secondary === "dash"
                      ? "Dash"
                      : localPlayer.secondary}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Weapon charge, photon rifle recharge, or secondary cooldown - centered (reused bar) */}
      {(weaponChargeProgress > 0 ||
        (isPhotonRifle && isRecharging) ||
        isSecondaryOnCooldown) && (
        <div className="absolute left-1/2 bottom-8 -translate-x-1/2 pointer-events-auto">
          <div
            className={`backdrop-blur-sm rounded-lg p-2 border ${
              isSecondaryOnCooldown
                ? "bg-black/50 border-pink-500/30"
                : "bg-black/50 border-cyan-500/30"
            }`}
          >
            <div
              className={`text-xs mb-1 ${
                isSecondaryOnCooldown ? "text-pink-400" : "text-cyan-400"
              }`}
            >
              {isSecondaryOnCooldown
                ? "SECONDARY"
                : isRecharging
                  ? "RECHARGE"
                  : "CHARGE"}
            </div>
            <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  isSecondaryOnCooldown
                    ? "bg-pink-500/70"
                    : isRecharging
                      ? "bg-cyan-500/60"
                      : "bg-cyan-500"
                }`}
                style={{
                  width: `${
                    isSecondaryOnCooldown
                      ? Math.min(
                          100,
                          Math.max(0, secondaryCooldownProgress * 100),
                        )
                      : isRecharging
                        ? Math.min(100, Math.max(0, rechargeProgress * 100))
                        : Math.min(100, weaponChargeProgress * 100)
                  }%`,
                  boxShadow: isSecondaryOnCooldown
                    ? "0 0 8px #ff69b4"
                    : "0 0 8px #00ffff",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Minimap - bottom left corner */}
      <div className="absolute bottom-8 left-8">
        <GameMinimap />
      </div>

      {/* Kill Feed - marble/neon/tron themed (newest at bottom), to the right of minimap */}
      <div className="absolute bottom-8 left-[164px]">
        <div className="space-y-1.5">
          {[...killFeed].reverse().map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className="px-3 py-1.5 animate-fade-in text-xs
                bg-black/80 border border-cyan-400/60
                shadow-[0_0_12px_rgba(0,255,255,0.2),inset_0_0_0_1px_rgba(0,255,255,0.15)]"
              style={{
                clipPath:
                  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))",
              }}
            >
              {event.weapon && event.weapon !== "unknown" ? (
                <>
                  <span className="text-cyan-300 font-medium drop-shadow-[0_0_4px_rgba(0,255,255,0.5)]">
                    {event.killerName}
                  </span>
                  <span className="text-cyan-500/80 mx-1.5">
                    [{event.weapon}]
                  </span>
                  <span className="text-pink-400 font-medium drop-shadow-[0_0_4px_rgba(255,105,180,0.5)]">
                    {event.victimName}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-cyan-300 font-medium drop-shadow-[0_0_4px_rgba(0,255,255,0.5)]">
                    {event.killerName}
                  </span>
                  <span className="text-cyan-500/60 mx-1.5">smashed</span>
                  <span className="text-pink-400 font-medium drop-shadow-[0_0_4px_rgba(255,105,180,0.5)]">
                    {event.victimName}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scoreboard */}
      <div className="absolute top-8 left-8">
        <div className="bg-black/50 backdrop-blur-sm rounded-lg p-3 border border-purple-500/30 min-w-[180px]">
          {currentLobby?.gameMode === "captureTheFlag" ? (
            <>
              <div className="text-xs text-gray-400 mb-2">
                FLAGS · First to {currentLobby?.flagLimit ?? 3} to win
              </div>
              {(() => {
                const allP = Array.from(players.values()).concat(
                  localPlayer ? [localPlayer] : [],
                );
                const teamScores = new Map<number, number>();
                for (const p of allP.filter(Boolean)) {
                  const t = p.team ?? 0;
                  teamScores.set(
                    t,
                    (teamScores.get(t) ?? 0) + (p.flagCaptures ?? 0),
                  );
                }
                const sorted = [...teamScores.entries()].sort(
                  (a, b) => b[1] - a[1],
                );
                return (
                  <div className="space-y-1">
                    {sorted.map(([team, score]) => {
                      const c =
                        TEAM_COLORS[Math.min(team, TEAM_COLORS.length - 1)] ??
                        TEAM_COLORS[0];
                      const hex = teamColorToHex(c);
                      const isLocal =
                        localPlayer && (localPlayer.team ?? 0) === team;
                      return (
                        <div
                          key={team}
                          className="flex justify-between text-sm items-center"
                        >
                          <span
                            className={isLocal ? "font-bold" : ""}
                            style={{ color: hex }}
                          >
                            Team {team + 1}
                          </span>
                          <span
                            className="text-pink-400"
                            style={isLocal ? { color: hex } : undefined}
                          >
                            {score} flags
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          ) : currentLobby?.gameMode === "teamDeathmatch" ? (
            <>
              <div className="text-xs text-gray-400 mb-2">
                KILLS · First to {currentLobby?.scoreLimit ?? 25} to win
              </div>
              {(() => {
                const allP = Array.from(players.values()).concat(
                  localPlayer ? [localPlayer] : [],
                );
                const teamScores = new Map<number, number>();
                for (const p of allP.filter(Boolean)) {
                  const t = p.team ?? 0;
                  teamScores.set(t, (teamScores.get(t) ?? 0) + p.kills);
                }
                const sorted = [...teamScores.entries()].sort(
                  (a, b) => b[1] - a[1],
                );
                return (
                  <div className="space-y-1">
                    {sorted.map(([team, kills]) => {
                      const c =
                        TEAM_COLORS[Math.min(team, TEAM_COLORS.length - 1)] ??
                        TEAM_COLORS[0];
                      const hex = teamColorToHex(c);
                      const isLocal =
                        localPlayer && (localPlayer.team ?? 0) === team;
                      return (
                        <div
                          key={team}
                          className="flex justify-between text-sm items-center"
                        >
                          <span
                            className={isLocal ? "font-bold" : ""}
                            style={{ color: hex }}
                          >
                            Team {team + 1}
                          </span>
                          <span
                            className="text-cyan-400"
                            style={isLocal ? { color: hex } : undefined}
                          >
                            {kills}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          ) : (
            <>
              <div className="text-xs text-gray-400 mb-2">
                First to {currentLobby?.scoreLimit ?? 25} to win
              </div>
              <div className="space-y-1">
                {Array.from(players.values())
                  .concat(localPlayer ? [localPlayer] : [])
                  .filter((p) => p)
                  .sort((a, b) => b.kills - a.kills)
                  .slice(0, 5)
                  .map((p, i) => (
                    <div
                      key={p.id}
                      className="flex justify-between text-sm gap-4"
                    >
                      <span
                        className={
                          p.id === localPlayer?.id
                            ? "text-cyan-400 font-bold"
                            : "text-gray-300"
                        }
                      >
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-cyan-400">{p.kills}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
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
    </div>
  );
}
