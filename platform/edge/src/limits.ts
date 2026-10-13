// Abuse limits. Per-IP rate limits are counted by a Limiter Durable Object per
// IP (exact, unlike Cloudflare's rate limiting binding, which let 360 upgrades
// a minute through a 120 limit on staging). Enabled by the RATE_LIMITS var in
// staging and production; local dev and torture have none. The relay budget
// is a per-session token bucket. Limits are sized well above real play: they
// stop floods and runaway costs, and the usage alerts (usage.ts) fire long
// before players meet them.

import { DurableObject } from "cloudflare:workers";

export type LimitKind = "connect" | "session" | "create" | "join" | "login";

/** Per IP, per minute. */
export const LIMITS: Record<LimitKind, number> = {
  /** WebSocket upgrades (checked in the Worker, before any session). */
  connect: 120,
  /** New sessions: each mints relay credentials and warms a room. */
  session: 30,
  create: 30,
  /** A join to a missing code still wakes a Room object. */
  join: 60,
  /** Browser sign-ins started (Sign in through Steam). */
  login: 30,
};
export const LIMIT_WINDOW_MS = 60_000;
/** A limiter slower than this allows: a limiter problem must not stop play. */
const LIMIT_TIMEOUT_MS = 250;

export interface LimitEnv {
  LIMITER?: DurableObjectNamespace<Limiter>;
  /** "on" for the defaults, or JSON overriding some of them (e.g. {"session":3}). Unset: no limits. */
  RATE_LIMITS?: string;
}

export function limitsFor(env: LimitEnv): Record<LimitKind, number> | null {
  const v = env.RATE_LIMITS?.trim();
  if (!v || v === "off") return null;
  if (v === "on") return LIMITS;
  try {
    return { ...LIMITS, ...(JSON.parse(v) as Partial<Record<LimitKind, number>>) };
  } catch {
    return LIMITS;
  }
}

/** True when allowed. Limits off, no limiter, or the limiter failing or slow, allows. */
export async function allowed(env: LimitEnv, kind: LimitKind, ip: string): Promise<boolean> {
  const limits = limitsFor(env);
  if (!limits || !env.LIMITER) return true;
  const key = ip || "unknown";
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName(key));
    const timeout = new Promise<boolean>((ok) => setTimeout(() => ok(true), LIMIT_TIMEOUT_MS));
    return await Promise.race([stub.take(kind, limits[kind]), timeout]);
  } catch {
    return true;
  }
}

/**
 * Limiter DO: one per client IP, counting each kind in fixed one-minute
 * windows, in memory only (an idle limiter is evicted and starts fresh).
 */
export class Limiter extends DurableObject {
  private windows = new Map<LimitKind, { start: number; n: number }>();

  async take(kind: LimitKind, limit: number, now = Date.now()): Promise<boolean> {
    let w = this.windows.get(kind);
    if (!w || now - w.start >= LIMIT_WINDOW_MS) {
      w = { start: now, n: 0 };
      this.windows.set(kind, w);
    }
    w.n++;
    return w.n <= limit;
  }
}

/** Relayed deliveries (one frame to one member) a session may make per second, sustained. */
export const RELAY_RATE = 2000;
/** Burst on top of the rate. */
export const RELAY_BURST = 4000;

/** A token bucket; in memory only (a hibernated session starts full again). */
export class Bucket {
  private tokens: number;
  private at: number;
  constructor(private rate: number, private burst: number, now = Date.now()) {
    this.tokens = burst;
    this.at = now;
  }
  take(n: number, now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
