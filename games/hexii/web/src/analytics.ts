import { useGameStore } from "../../store/gameStore";
import { GAME, api, deviceId } from "./partii";

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

function sessionProps(extra: Record<string, string | number | boolean> = {}) {
  return extra;
}

export function track(
  name: string,
  props: Record<string, string | number | boolean> = {},
): void {
  if (!sessionId) return;
  queue.push({ name, at: Date.now(), session: sessionId, props: sessionProps(props) });
  if (queue.length >= 20) void flush();
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const events = queue.splice(0, 100);
  try {
    await api.analyticsIngest(GAME, {
      device: deviceId(),
      platform: "web",
      version: VERSION,
      events,
    });
  } catch {
    queue.unshift(...events);
  } finally {
    flushing = false;
  }
}

function endSession(): void {
  if (ended || !sessionId) return;
  ended = true;
  const secs = Math.max(0, Math.round((Date.now() - sessionStarted) / 1000));
  track("session_end", { secs });
}

/** Queue gameplay events and send them every 30s and when the page hides. */
export function installAnalytics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  sessionId = crypto.randomUUID();
  sessionStarted = Date.now();
  track("session_start", {});
  window.setInterval(() => void flush(), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => {
    endSession();
    void flush();
  });
}

/** Follow one run. Call again with false when the player returns to the menu. */
export function watchRun(active: boolean): void {
  stopWatch?.();
  stopWatch = null;
  if (!active) return;

  const started = Date.now();
  const secs = () => Math.max(0, Math.round((Date.now() - started) / 1000));
  let lastWave = useGameStore.getState().wave;
  let lastBosses = useGameStore.getState().bossesDefeated;
  let dead = false;
  let won = false;
  track("run_start", {});
  track("wave_reached", { wave: lastWave });

  stopWatch = useGameStore.subscribe((state) => {
    if (state.wave !== lastWave) {
      lastWave = state.wave;
      track("wave_reached", { wave: state.wave });
    }
    if (state.bossesDefeated > lastBosses) {
      lastBosses = state.bossesDefeated;
      track("boss_defeated", { wave: state.wave });
    }
    if (state.isDead && !dead) {
      dead = true;
      track("death", {
        wave: state.wave,
        score: state.score,
        level: state.level,
        secs: secs(),
      });
    }
    if (state.showWinScreen && !won) {
      won = true;
      track("win", { score: state.score, secs: secs() });
    }
  });
}

let reporting = false;

function reportError(message: string, backtrace: string): void {
  const text = message.trim().slice(0, 500);
  if (!text || reporting) return;
  reporting = true;
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
  void api.errorsIngest(GAME, body).finally(() => {
    reporting = false;
  });
}

/** Send window errors as they happen. */
export function installErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    const stack = event.error instanceof Error ? (event.error.stack ?? "") : "";
    reportError(event.message || "Script error", stack);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason instanceof Error) reportError(reason.message, reason.stack ?? "");
    else reportError(String(reason), "");
  });
}
