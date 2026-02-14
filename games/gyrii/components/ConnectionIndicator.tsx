"use client";

import { useGyriiStore } from "../store/gameStore";

export default function ConnectionIndicator() {
  const isConnected = useGyriiStore((s) => s.isConnected);
  const isConnecting = useGyriiStore((s) => s.isConnecting);
  const connectionError = useGyriiStore((s) => s.connectionError);

  // Green: connected, Yellow: connecting, Red: disconnected/error
  const status = isConnected
    ? "connected"
    : isConnecting
      ? "connecting"
      : "error";
  const bgColor =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : connectionError || "Disconnected";

  return (
    <div
      className="absolute bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 border border-white/10"
      title={label}
    >
      <div
        className={`h-2.5 w-2.5 rounded-full ${bgColor} ${status === "connecting" ? "animate-pulse" : ""}`}
      />
      <span className="text-xs text-white/80">{label}</span>
    </div>
  );
}
