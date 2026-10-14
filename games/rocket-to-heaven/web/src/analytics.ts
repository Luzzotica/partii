import { useGameStore } from "../../store/gameStore";
import { altitudeMarks } from "./altitudeMarks";
import { GAME, deviceId, savedToken } from "./partii";

interface QueuedEvent {
  name: string;
  at: number;
  session: string;
  props: Record<string, string | number | boolean>;
}

const VERSION = "1";
let sessionId = "";
let sessionStarted = 0;
let installed = false;
let ended = false;
let stopWatch: (() => void) | null = null;
const queue: QueuedEvent[] = [];
let flushing = false;
let flushAgain = false;

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function track(
  name: string,
  props: Record<string, string | number | boolean> = {},
): void {
  if (!sessionId || ended) return;
  queue.push({ name, at: Date.now(), session: sessionId, props });
}

async function postEvents(events: QueuedEvent[], keepalive: boolean): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-partii-key": __PARTII_KEY__,
  };
  const token = savedToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${__PARTII_API__.replace(/\/$/, "")}/v1/games/${GAME}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      device: deviceId(),
      platform: "web",
      version: VERSION,
      events,
    }),
    keepalive,
  });
  if (!res.ok) throw new Error(`events ${res.status}`);
}

/** Send the queue. `keepalive` lets the browser finish the request as the page closes. */
export async function flush(keepalive = false): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  if (queue.length === 0) return;
  flushing = true;
  const events = queue.splice(0, 100);
  try {
    await postEvents(events, keepalive);
  } catch {
    queue.unshift(...events);
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      void flush(keepalive);
    }
  }
}

function endSession(): void {
  if (ended || !sessionId) return;
  const secs = Math.max(0, Math.round((Date.now() - sessionStarted) / 1000));
  track("session_end", { secs });
  ended = true;
}

/** Queue a session and send it every 30s and when the page hides. */
export function installAnalytics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  sessionId = newId();
  sessionStarted = Date.now();
  track("session_start", {});
  window.setInterval(() => void flush(false), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("pagehide", () => {
    endSession();
    void flush(true);
  });
}

function runSecs(startedAt: number): number {
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

/** Follow one visit to the game. Call again with false when the player returns to the menu. */
export function watchRun(active: boolean): void {
  stopWatch?.();
  stopWatch = null;
  if (!active) return;

  let runStart = 0;
  let lastHeight = 0;
  let dead = false;
  let won = false;

  const begin = (startTime: number, height: number) => {
    runStart = startTime;
    lastHeight = 0;
    dead = false;
    won = false;
    track("run_start", {});
    for (const feet of altitudeMarks(0, height)) track("altitude", { feet });
    lastHeight = height;
  };

  const stateNow = useGameStore.getState();
  if (stateNow.gameStarted && stateNow.gameStartTime) {
    begin(stateNow.gameStartTime, stateNow.maxHeight);
  }

  stopWatch = useGameStore.subscribe((state) => {
    if (state.gameStarted && state.gameStartTime && state.gameStartTime !== runStart) {
      begin(state.gameStartTime, state.maxHeight);
    }
    if (!runStart) return;

    for (const feet of altitudeMarks(lastHeight, state.maxHeight)) {
      track("altitude", { feet });
    }
    lastHeight = state.maxHeight;

    if (state.isDead && !dead) {
      dead = true;
      track("death", {
        feet: Math.max(0, Math.round(state.maxHeight)),
        secs: Math.max(0, Math.round(state.playTimeSeconds)) || runSecs(runStart),
        cause: state.deathCause ?? "unknown",
      });
    }
    if (state.hasWon && !won) {
      won = true;
      track("victory", {
        secs: Math.max(0, Math.round(state.playTimeSeconds)) || runSecs(runStart),
      });
    }
  });
}

let reporting = false;

function reportError(message: string, backtrace: string): void {
  const text = message.trim().slice(0, 500);
  if (!text || reporting) return;
  reporting = true;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-partii-key": __PARTII_KEY__,
  };
  const token = savedToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const body = {
    device: deviceId(),
    platform: "web",
    version: VERSION,
    errors: [
      {
        kind: "error",
        message: text,
        backtrace: backtrace.slice(0, 4000),
        session: sessionId || undefined,
        at: Date.now(),
      },
    ],
  };
  void fetch(`${__PARTII_API__.replace(/\/$/, "")}/v1/games/${GAME}/errors`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).finally(() => {
    reporting = false;
  });
}

/** Send script errors as they happen. Resource failures (a missing favicon) are not script errors. */
export function installErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.onerror = (message, _source, _line, _col, error) => {
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    reportError(typeof message === "string" ? message : "Script error", stack);
    return false;
  };
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    if (reason instanceof Error) reportError(reason.message, reason.stack ?? "");
    else reportError(String(reason), "");
  });
}
