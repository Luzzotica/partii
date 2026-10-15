// partii.games reports to partii, like any game on it: page views, the games
// people look at and play, sign-ups and purchases, and the site's own errors,
// under the "partii" game (the store key's project). No cookies: a random id
// in localStorage, and a session per tab that ends after 30 idle minutes.
// Events stay off when the browser asks not to be tracked (Global Privacy
// Control or Do Not Track); error reports still go, without the browser's id.

const API = import.meta.env.VITE_PARTII_API ?? "https://api.partii.games";
const KEY = import.meta.env.VITE_PARTII_KEY ?? "";
const GAME = import.meta.env.VITE_PARTII_ANALYTICS_GAME ?? "partii";
const EVERY_MS = 15_000;
const IDLE_MS = 30 * 60_000;
const MAX_ERRORS = 10;

type Props = Record<string, string | number | boolean>;

const optedOut = (() => {
  try {
    return (navigator as any).globalPrivacyControl === true || navigator.doNotTrack === "1";
  } catch {
    return false;
  }
})();

function local<T>(k: string, v?: T, where: () => Storage = () => localStorage): T | null {
  try {
    if (v !== undefined) where().setItem(k, JSON.stringify(v));
    const s = where().getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return v ?? null;
  }
}

const newId = () => crypto.randomUUID().replace(/-/g, "");

/** This browser's random id (also the guest account's device id). */
export function deviceId(): string {
  return local<string>("partii.device") ?? local("partii.device", newId())!;
}

let session = { id: "", last: 0 };
let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
let visibleMs = 0;
let queue: { name: string; at: number; session: string; props: Props }[] = [];
let errorsSent = 0;
const errorsSeen = new Set<string>();

function currentSession(): string {
  const t = Date.now();
  if (!session.id) session = local<typeof session>("partii.session", undefined, () => sessionStorage) ?? session;
  if (!session.id || t - session.last > IDLE_MS) {
    session = { id: newId(), last: t };
    visibleMs = 0;
    queue.push({ name: "session_start", at: t, session: session.id, props: { ref: referrer(), utm: utm() } });
  }
  session.last = t;
  local("partii.session", session, () => sessionStorage);
  return session.id;
}

/** Where the visit came from: another site's host, or "" (direct, or within partii.games). */
function referrer(): string {
  try {
    const h = document.referrer ? new URL(document.referrer).hostname : "";
    return h === location.hostname ? "" : h.slice(0, 100);
  } catch {
    return "";
  }
}

const utm = () => (new URLSearchParams(location.search).get("utm_source") ?? "").slice(0, 60);

function context() {
  return { platform: "web", version: __COMMIT__, build: location.hostname === "partii.games" ? "production" : "preview" };
}

function post(path: "events" | "errors", body: object, beacon: boolean) {
  if (!KEY) return;
  const url = `${API}/v1/games/${GAME}/${path}?key=${encodeURIComponent(KEY)}`;
  // text/plain needs no preflight, so the page can send it as it closes.
  const blob = new Blob([JSON.stringify(body)], { type: "text/plain" });
  if (beacon && navigator.sendBeacon?.(url, blob)) return;
  fetch(url, { method: "POST", body: blob, keepalive: true }).catch(() => {});
}

function flush(beacon = false) {
  if (!queue.length) return;
  const events = queue.splice(0, 100);
  post("events", { device: deviceId(), ...context(), events }, beacon);
  if (queue.length) flush(beacon);
}

/** Record an event (sent in a batch every 15 s, and when the page is hidden). */
export function track(name: string, props: Props = {}) {
  if (optedOut) return;
  const s = currentSession();
  queue.push({ name, at: Date.now(), session: s, props });
}

/** Report something that went wrong (an error the user saw, or a failed purchase). */
export function reportError(message: string, opts: { stack?: string; context?: Props; kind?: "error" | "warning" } = {}) {
  const key = message.slice(0, 200);
  if (errorsSeen.has(key) || errorsSent >= MAX_ERRORS) return;
  errorsSeen.add(key);
  errorsSent++;
  const device = optedOut ? `anon-${newId()}` : deviceId();
  const error = { kind: opts.kind ?? "error", message, backtrace: opts.stack ?? "", at: Date.now(), session: optedOut ? "" : session.id, context: { path: location.pathname, ...opts.context } };
  post("errors", { device, ...context(), errors: [error] }, false);
}

/** How long the tab has been visible this session, in seconds. */
const visibleSecs = () => Math.round((visibleMs + (visibleSince ? Date.now() - visibleSince : 0)) / 1000);

/** Start: errors, page hides (the session's length so far goes as session_end), and the timer. */
export function startTracking() {
  addEventListener("error", (e) => {
    if (e.error || e.message) reportError(String(e.message || e.error), { stack: e.error?.stack, context: { source: (e.filename ?? "").slice(-80), line: e.lineno ?? 0 } });
  });
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    reportError(`unhandled rejection: ${r instanceof Error ? r.message : String(r)}`, { stack: r instanceof Error ? r.stack : "" });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (visibleSince) (visibleMs += Date.now() - visibleSince), (visibleSince = 0);
      if (session.id && !optedOut) queue.push({ name: "session_end", at: Date.now(), session: session.id, props: { secs: visibleSecs() } });
      flush(true);
    } else {
      visibleSince = Date.now();
    }
  });
  // Links off the site: which ones people follow (Discord, YouTube, app stores).
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (a && a.hostname && a.hostname !== location.hostname) track("outbound", { host: a.hostname.slice(0, 100) });
  }, true);
  setInterval(() => flush(), EVERY_MS);
}
