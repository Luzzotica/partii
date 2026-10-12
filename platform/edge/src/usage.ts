// Usage DO: one per project, named by the project id. Sessions and rooms
// report when they start and end (fire and forget, never on a request's
// path), and limit hits are counted. It keeps live counts, peaks and hourly
// counters, and raises an alert (Workers Logs, plus ALERT_WEBHOOK_URL when
// set) when a count crosses its threshold. Alerts only: nothing here blocks.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

export type LiveKind = "session" | "room";
export type HitKind = "connect" | "session" | "create" | "join" | "relay";

/** Defaults, sized for the demo (about 200 players and 50 rooms); override with vars. */
export const ALERT_DEFAULTS = {
  sessions: 150,
  rooms: 40,
  /** Rate-limited requests (all kinds) in the current hour. */
  limited: 50,
  /** Relayed deliveries dropped by the relay budget in the current hour. */
  relay_dropped: 10_000,
};

/** A live row nobody has touched for this long is gone (its end report was lost). */
export const STALE_MS: Record<LiveKind, number> = { session: 5 * 3600_000, room: 12 * 3600_000 };
/** The same alert is not repeated within this window unless its count doubles. */
export const ALERT_REPEAT_MS = 3600_000;
const HOURS_KEPT = 48;

export interface Alert {
  at: number;
  project: string;
  metric: keyof typeof ALERT_DEFAULTS;
  value: number;
  threshold: number;
}

export interface UsageView {
  project: string;
  sessions: number;
  rooms: number;
  peak: { sessions: number; sessions_at: number | null; rooms: number; rooms_at: number | null };
  /** Counters for the current and previous hour (`hour` is its start, ms). */
  hours: { hour: number; counts: Partial<Record<`limited_${HitKind}` | "relay_dropped" | "sessions_started" | "rooms_started", number>> }[];
  thresholds: typeof ALERT_DEFAULTS;
  alerts: Alert[];
}

const hourOf = (t: number) => t - (t % 3600_000);

export class Usage extends DurableObject<Env> {
  private ready = false;

  private sql() {
    const sql = this.ctx.storage.sql;
    if (!this.ready) {
      sql.exec("CREATE TABLE IF NOT EXISTS live (kind TEXT NOT NULL, id TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY (kind, id))");
      sql.exec("CREATE TABLE IF NOT EXISTS hours (hour INTEGER NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (hour, name))");
      this.ready = true;
    }
    return sql;
  }

  private project(): string {
    return (this.ctx.storage.kv.get("project") as string | undefined) ?? "?";
  }

  thresholds(): typeof ALERT_DEFAULTS {
    const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      sessions: n(this.env.ALERT_SESSIONS, ALERT_DEFAULTS.sessions),
      rooms: n(this.env.ALERT_ROOMS, ALERT_DEFAULTS.rooms),
      limited: n(this.env.ALERT_LIMITED, ALERT_DEFAULTS.limited),
      relay_dropped: n(this.env.ALERT_RELAY_DROPPED, ALERT_DEFAULTS.relay_dropped),
    };
  }

  private bump(name: string, n: number, now: number) {
    this.sql().exec("INSERT INTO hours (hour, name, n) VALUES (?, ?, ?) ON CONFLICT (hour, name) DO UPDATE SET n = n + excluded.n", hourOf(now), name, n);
  }
  private hourCount(name: string | string[], now: number): number {
    const names = Array.isArray(name) ? name : [name];
    const row = this.sql()
      .exec(`SELECT COALESCE(SUM(n), 0) AS n FROM hours WHERE hour = ? AND name IN (${names.map(() => "?").join(",")})`, hourOf(now), ...names)
      .one();
    return Number(row.n);
  }
  private live(kind: LiveKind): number {
    return Number(this.sql().exec("SELECT COUNT(*) AS n FROM live WHERE kind = ?", kind).one().n);
  }

  private prune(now: number) {
    const last = (this.ctx.storage.kv.get("pruned") as number | undefined) ?? 0;
    if (now - last < 60_000) return;
    this.ctx.storage.kv.put("pruned", now);
    for (const kind of ["session", "room"] as LiveKind[]) this.sql().exec("DELETE FROM live WHERE kind = ? AND seen < ?", kind, now - STALE_MS[kind]);
    this.sql().exec("DELETE FROM hours WHERE hour < ?", hourOf(now) - HOURS_KEPT * 3600_000);
  }

  /** A session or room started (or is still alive: calling again refreshes it). */
  async up(project: string, kind: LiveKind, id: string, now = Date.now()): Promise<void> {
    this.ctx.storage.kv.put("project", project);
    const fresh = this.sql().exec("SELECT 1 FROM live WHERE kind = ? AND id = ?", kind, id).toArray().length === 0;
    this.sql().exec("INSERT INTO live (kind, id, seen) VALUES (?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET seen = excluded.seen", kind, id, now);
    if (fresh) this.bump(kind === "session" ? "sessions_started" : "rooms_started", 1, now);
    this.prune(now);
    const count = this.live(kind);
    const peakKey = kind === "session" ? "peak_sessions" : "peak_rooms";
    const peak = (this.ctx.storage.kv.get(peakKey) as { n: number; at: number } | undefined) ?? { n: 0, at: 0 };
    if (count > peak.n) this.ctx.storage.kv.put(peakKey, { n: count, at: now });
    await this.check(kind === "session" ? "sessions" : "rooms", count, now);
  }

  /** A session or room ended. */
  async down(kind: LiveKind, id: string): Promise<void> {
    this.sql().exec("DELETE FROM live WHERE kind = ? AND id = ?", kind, id);
  }

  /** Requests refused by a limit (`relay`: deliveries dropped by the relay budget). */
  async hit(project: string, kind: HitKind, n = 1, now = Date.now()): Promise<void> {
    this.ctx.storage.kv.put("project", project);
    if (kind === "relay") {
      this.bump("relay_dropped", n, now);
      await this.check("relay_dropped", this.hourCount("relay_dropped", now), now);
    } else {
      this.bump(`limited_${kind}`, n, now);
      await this.check("limited", this.hourCount(["limited_connect", "limited_session", "limited_create", "limited_join"], now), now);
    }
  }

  private async check(metric: keyof typeof ALERT_DEFAULTS, value: number, now: number) {
    const threshold = this.thresholds()[metric];
    if (value < threshold) return;
    const last = this.ctx.storage.kv.get(`alert:${metric}`) as { at: number; value: number } | undefined;
    if (last && now - last.at < ALERT_REPEAT_MS && value < last.value * 2) return;
    this.ctx.storage.kv.put(`alert:${metric}`, { at: now, value });
    const alert: Alert = { at: now, project: this.project(), metric, value, threshold };
    const log = ((this.ctx.storage.kv.get("alerts") as Alert[] | undefined) ?? []).concat(alert).slice(-50);
    this.ctx.storage.kv.put("alerts", log);
    await sendAlert(this.env, alert);
  }

  async view(): Promise<UsageView> {
    const now = Date.now();
    this.prune(now);
    const peakS = this.ctx.storage.kv.get("peak_sessions") as { n: number; at: number } | undefined;
    const peakR = this.ctx.storage.kv.get("peak_rooms") as { n: number; at: number } | undefined;
    const hours = [hourOf(now), hourOf(now) - 3600_000].map((hour) => {
      const counts: Record<string, number> = {};
      for (const r of this.sql().exec("SELECT name, n FROM hours WHERE hour = ?", hour)) counts[String(r.name)] = Number(r.n);
      return { hour, counts };
    });
    return {
      project: this.project(),
      sessions: this.live("session"),
      rooms: this.live("room"),
      peak: { sessions: peakS?.n ?? 0, sessions_at: peakS?.at ?? null, rooms: peakR?.n ?? 0, rooms_at: peakR?.at ?? null },
      hours,
      thresholds: this.thresholds(),
      alerts: ((this.ctx.storage.kv.get("alerts") as Alert[] | undefined) ?? []).slice(-20),
    };
  }
}

export function alertText(a: Alert): string {
  const what: Record<Alert["metric"], string> = {
    sessions: "live sessions",
    rooms: "live rooms",
    limited: "rate-limited requests this hour",
    relay_dropped: "relay deliveries dropped this hour",
  };
  return `partii alert: project ${a.project} has ${a.value} ${what[a.metric]} (alert at ${a.threshold})`;
}

/** Log the alert, and post it to ALERT_WEBHOOK_URL when set (Slack reads `text`, Discord `content`). */
export async function sendAlert(env: Pick<Env, "ALERT_WEBHOOK_URL" | "PARTII_ENV">, a: Alert, fetcher: typeof fetch = fetch): Promise<void> {
  const text = `[${env.PARTII_ENV}] ${alertText(a)}`;
  console.warn(JSON.stringify({ alert: true, env: env.PARTII_ENV, ...a, text }));
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetcher(env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }) });
  } catch (e) {
    console.error(JSON.stringify({ alert_delivery_failed: true, error: String(e) }));
  }
}

/** The Usage object for counts not tied to a project (refused before a key was seen). */
export const EDGE_USAGE = "_edge";

/** The project's Usage object. */
export function usage(env: Env, project: string) {
  return env.USAGE.get(env.USAGE.idFromName(project));
}
