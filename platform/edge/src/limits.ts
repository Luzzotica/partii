// Abuse limits. Per-IP rate limits use Cloudflare's rate limiting bindings
// (configured per environment in wrangler.jsonc; absent locally and in tests,
// where nothing is limited). The relay budget is a per-session token bucket.
// Limits are sized well above real play: they stop floods and runaway costs,
// and the usage alerts (usage.ts) fire long before players meet them.

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface LimitEnv {
  /** WebSocket upgrades per IP (checked in the Worker, before any Durable Object). */
  RL_CONNECT?: RateLimiter;
  /** New sessions per IP: each mints relay credentials and warms a room. */
  RL_SESSION?: RateLimiter;
  /** Room creates per IP. */
  RL_CREATE?: RateLimiter;
  /** Room joins per IP (a join to a missing code still wakes a Room object). */
  RL_JOIN?: RateLimiter;
}

export type LimitKind = "connect" | "session" | "create" | "join";

const BINDING: Record<LimitKind, keyof LimitEnv> = {
  connect: "RL_CONNECT",
  session: "RL_SESSION",
  create: "RL_CREATE",
  join: "RL_JOIN",
};

/** True when allowed. No binding, or the limiter failing, allows: a limiter outage must not stop play. */
export async function allowed(env: LimitEnv, kind: LimitKind, ip: string): Promise<boolean> {
  const rl = env[BINDING[kind]];
  if (!rl) return true;
  try {
    return (await rl.limit({ key: `${kind}:${ip || "unknown"}` })).success;
  } catch {
    return true;
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
