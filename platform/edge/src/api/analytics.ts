// Analytics for every game on partii: games send events and error reports
// with their publishable key (the account crate batches them); developers read
// players (DAU/WAU/MAU, new vs returning), sessions, D1/D7/D30 retention,
// per-event counts and funnels, and grouped errors, on the store's /dev page or
// with `partii analytics` / `partii errors`. A device is the game's install
// id; no IPs are stored, only the country Cloudflare reports. Raw events are
// kept EVENTS_KEEP_DAYS; the daily tables are small and kept.

import type { Env } from "../index";
import { allowed } from "../limits";
import { ApiError, bad, notFound, now, ownGame, sha256hex, type Caller } from "./core";
import type { Handlers } from "./index";
import { optionalPlayer } from "./ugc";

export const ANALYTICS_LIMITS = { eventsPerCall: 100, errorsPerCall: 20, propsBytes: 1024, contextBytes: 2048, stringChars: 200, messageChars: 2000, backtraceBytes: 16_384, samplesKept: 10, maxDays: 365 };
export const EVENTS_KEEP_DAYS = 90;
const DAY_MS = 86_400_000;
/** `at` further back than this (or in the future) is replaced by the server's time. */
const MAX_AGE_MS = 7 * DAY_MS;

const dayOf = (t: number) => Math.floor(t / DAY_MS);
const dayIso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

const NAME = /^[a-z][a-z0-9_.]{0,47}$/;
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;
const PROP = /^[A-Za-z0-9_]{1,40}$/;

/** What every batch carries once: who sent it and what they ran. */
interface Context {
  device: string;
  player: string | null;
  platform: string;
  version: string;
  build: string;
  owned: number | null;
}

const short = (v: unknown, max: number, re = /^[A-Za-z0-9._+-]*$/) => (typeof v === "string" && v.length <= max && re.test(v) ? v : "");

/** The batch context; a bad device id refuses the batch, anything else unreadable is left blank. */
async function batchContext(env: Env, req: Request, body: Record<string, any>): Promise<Context> {
  if (typeof body.device !== "string" || !DEVICE.test(body.device)) throw bad("device must be the install id (8–64 chars of [A-Za-z0-9_-])", "the account crate sends it for you");
  return {
    device: body.device,
    player: await optionalPlayer(env, req),
    platform: short(body.platform, 16, /^[a-z0-9_-]*$/),
    version: short(body.version, 32),
    build: short(body.build, 32),
    owned: body.owned === true ? 1 : body.owned === false ? 0 : null,
  };
}

/** Flat props only: short strings, finite numbers, bools. Returns null when nothing fits. */
function cleanProps(v: unknown, maxBytes: number): string | null {
  if (v === undefined || v === null) return "{}";
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!PROP.test(k)) return null;
    if (typeof x === "string") {
      if (x.length > ANALYTICS_LIMITS.stringChars) return null;
      out[k] = x;
    } else if ((typeof x === "number" && Number.isFinite(x)) || typeof x === "boolean") out[k] = x;
    else return null;
  }
  const s = JSON.stringify(out);
  return s.length <= maxBytes ? s : null;
}

function clampAt(at: unknown, t: number): number {
  return typeof at === "number" && Number.isFinite(at) && at <= t + 5 * 60_000 && at >= t - MAX_AGE_MS ? Math.round(at) : t;
}

const gameProjects = new Map<string, { project: string; at: number }>();

/** The game must belong to the key's project. */
async function keyGame(env: Env, caller: Caller, game: string) {
  let hit = gameProjects.get(game);
  if (!hit || now() - hit.at > 60_000) {
    const g = await env.DB.prepare("SELECT project_id FROM games WHERE id = ?").bind(game).first<{ project_id: string }>();
    if (!g) throw notFound(`game ${game}`);
    hit = { project: g.project_id, at: now() };
    gameProjects.set(game, hit);
  }
  if (hit.project !== caller.project) throw notFound(`game ${game}`, "use the publishable key of the game's project");
}

async function rateLimit(env: Env, req: Request, kind: "events" | "errors", game: string, device: string) {
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  if (!(await allowed(env, kind, `${kind}:${game}:${device}`)) || !(await allowed(env, `${kind}_ip`, `${kind}:${ip}`))) {
    throw new ApiError(429, "rate_limited", `too many ${kind} calls from this device`, "batch them (the account crate sends every 30 s)");
  }
}

// ── Error fingerprints ──

/** A message with what varies between reports of the same bug (numbers, addresses, quoted text) blanked. */
export function normalizeMessage(m: string): string {
  return m
    .replace(/0x[0-9a-f]+/gi, "X")
    .replace(/\b[0-9a-f]{8,}\b/gi, "X")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "S")
    .replace(/\d+(\.\d+)?/g, "N")
    .slice(0, 300);
}

const PANIC_MACHINERY = /panicking|begin_unwind|begin_panic|rust_panic|panic_fmt|__rust_end_short_backtrace/;
const NOISE = /^(<?(std|core|alloc|backtrace)::|rust_begin_unwind|rust_panic|__rust|_start|__libc|start_thread|clone$|main$|<unknown>|___?pthread|thread_start)/;

/** The top frames that belong to the game (Rust backtraces; other formats: the first lines). */
export function topFrames(backtrace: string, n = 3): string[] {
  const lines = backtrace.split("\n");
  let rust = lines.map((l) => /^\s*\d+:\s+(\S.*?)\s*$/.exec(l)?.[1]).filter((f): f is string => !!f);
  // Frames above the panic machinery are the panic hook's own: skip them, and the machinery.
  let i = rust.findIndex((f) => PANIC_MACHINERY.test(f));
  if (i >= 0) {
    while (i < rust.length && (PANIC_MACHINERY.test(rust[i]) || NOISE.test(rust[i]))) i++;
    rust = rust.slice(i);
  }
  const frames = rust.length ? rust.map((f) => f.replace(/::h[0-9a-f]{16}$/, "")).filter((f) => !NOISE.test(f)) : lines.map((l) => l.trim().replace(/\d+/g, "N")).filter(Boolean);
  return frames.slice(0, n);
}

export async function fingerprint(kind: string, message: string, backtrace: string): Promise<string> {
  return (await sha256hex([kind, normalizeMessage(message), ...topFrames(backtrace)].join("\n"))).slice(0, 24);
}

// ── Reading: filters ──

interface Filters {
  days: number;
  from: number;
  today: number;
  where: string;
  args: unknown[];
}

/** days, platform, version, owned from the query; `where` is for a table with those columns, aliased `t`. */
function filters(q: Record<string, string>): Filters {
  const days = q.days ? Number(q.days) : 30;
  if (!Number.isInteger(days) || days < 1 || days > ANALYTICS_LIMITS.maxDays) throw bad(`days must be 1–${ANALYTICS_LIMITS.maxDays}`);
  const today = dayOf(now());
  let where = "";
  const args: unknown[] = [];
  if (q.platform) (where += " AND t.platform = ?"), args.push(q.platform);
  if (q.version) (where += " AND t.version = ?"), args.push(q.version);
  if (q.owned === "true" || q.owned === "false") (where += " AND t.owned = ?"), args.push(q.owned === "true" ? 1 : 0);
  return { days, from: today - days + 1, today, where, args };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round = (x: number | null, p = 1) => (x === null ? null : Math.round(x * 10 ** p) / 10 ** p);

interface GroupRow {
  game_id: string;
  fingerprint: string;
  kind: string;
  message: string;
  top_frame: string;
  first_seen: number;
  last_seen: number;
  count: number;
  devices: number;
  versions: string;
  platforms: string;
  status: string;
  status_at: number | null;
}

const groupView = (g: GroupRow) => ({
  fingerprint: g.fingerprint,
  kind: g.kind,
  message: g.message,
  top_frame: g.top_frame,
  first_seen: g.first_seen,
  last_seen: g.last_seen,
  count: g.count,
  devices: g.devices,
  versions: JSON.parse(g.versions),
  platforms: JSON.parse(g.platforms),
  status: g.status,
  status_at: g.status_at,
});

const addTo = (list: string, v: string, max = 20) => {
  const xs: string[] = JSON.parse(list);
  if (v && !xs.includes(v)) xs.push(v);
  return JSON.stringify(xs.slice(-max));
};

export const analyticsHandlers: Handlers = {
  // ── Ingest (games) ──

  async analyticsIngest({ env, req, caller, params, body, dryRun }) {
    await keyGame(env, caller, params.game);
    const cx = await batchContext(env, req, body);
    if (!Array.isArray(body.events)) throw bad("events must be an array", "{device, platform, version, events: [{name, at, session, props}]}");
    if (body.events.length > ANALYTICS_LIMITS.eventsPerCall) throw bad(`at most ${ANALYTICS_LIMITS.eventsPerCall} events per call`, "send the rest in another call");
    await rateLimit(env, req, "events", params.game, cx.device);
    const t = now();
    const game = params.game;
    const country = ((req as any).cf?.country as string | undefined) ?? "";
    const kept: { name: string; at: number; session: string; props: string }[] = [];
    for (const e of body.events) {
      if (!e || typeof e !== "object" || typeof e.name !== "string" || !NAME.test(e.name)) continue;
      const props = cleanProps(e.props, ANALYTICS_LIMITS.propsBytes);
      if (props === null) continue;
      kept.push({ name: e.name, at: clampAt(e.at, t), session: short(e.session, 64, /^[A-Za-z0-9_-]*$/), props });
    }
    const dropped = body.events.length - kept.length;
    if (dryRun || !kept.length) return { accepted: dryRun ? 0 : kept.length, dropped, ...(dryRun ? { dry_run: true, would_accept: kept.length } : {}) };

    const db = env.DB;
    const stmts: D1PreparedStatement[] = [];
    const ins = db.prepare("INSERT INTO events (game_id, at, day, name, device, player_id, session, platform, version, build, owned, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const e of kept) stmts.push(ins.bind(game, e.at, dayOf(e.at), e.name, cx.device, cx.player, e.session, cx.platform, cx.version, cx.build, cx.owned, e.props));
    const days = [...new Set(kept.map((e) => dayOf(e.at)))];
    stmts.push(
      db
        .prepare("INSERT INTO analytics_devices (game_id, device, first_day, last_day) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET first_day = MIN(first_day, excluded.first_day), last_day = MAX(last_day, excluded.last_day)")
        .bind(game, cx.device, Math.min(...days), Math.max(...days)),
    );
    const act = db.prepare(
      "INSERT INTO analytics_active (game_id, day, device, platform, version, owned, country) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET version = excluded.version, owned = COALESCE(excluded.owned, owned)",
    );
    for (const d of days) stmts.push(act.bind(game, d, cx.device, cx.platform, cx.version, cx.owned, country));
    // Sessions: span of their events; session_end's secs when it comes.
    const sessions = new Map<string, { first: number; last: number; secs: number | null }>();
    for (const e of kept) {
      if (!e.session) continue;
      const s = sessions.get(e.session) ?? { first: e.at, last: e.at, secs: null };
      s.first = Math.min(s.first, e.at);
      s.last = Math.max(s.last, e.at);
      if (e.name === "session_end") {
        const secs = JSON.parse(e.props).secs;
        if (typeof secs === "number" && secs >= 0) s.secs = secs;
      }
      sessions.set(e.session, s);
    }
    const ses = db.prepare(
      `INSERT INTO analytics_sessions (game_id, session, device, day, started_at, last_at, secs, platform, version, owned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET started_at = MIN(started_at, excluded.started_at), last_at = MAX(last_at, excluded.last_at), secs = COALESCE(excluded.secs, secs), owned = COALESCE(excluded.owned, owned)`,
    );
    for (const [id, s] of sessions) stmts.push(ses.bind(game, id, cx.device, dayOf(s.first), s.first, s.last, s.secs, cx.platform, cx.version, cx.owned));
    // Now and then, drop this game's expired raw events.
    if (Math.random() < 0.02) stmts.push(db.prepare("DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE game_id = ? AND at < ? LIMIT 5000)").bind(game, t - EVENTS_KEEP_DAYS * DAY_MS));
    await db.batch(stmts);
    return { accepted: kept.length, dropped };
  },

  async errorsIngest({ env, req, caller, params, body, dryRun }) {
    await keyGame(env, caller, params.game);
    const cx = await batchContext(env, req, body);
    if (!Array.isArray(body.errors) || !body.errors.length) throw bad("errors must be a non-empty array", "{device, platform, version, errors: [{kind, message, backtrace, context, session}]}");
    if (body.errors.length > ANALYTICS_LIMITS.errorsPerCall) throw bad(`at most ${ANALYTICS_LIMITS.errorsPerCall} errors per call`);
    await rateLimit(env, req, "errors", params.game, cx.device);
    const t = now();
    const game = params.game;
    const reports = [];
    for (const e of body.errors) {
      if (!e || typeof e !== "object") throw bad("each error must be an object");
      if (!["panic", "error", "warning"].includes(e.kind)) throw bad("kind must be panic, error or warning");
      if (typeof e.message !== "string" || !e.message.trim()) throw bad("message is required");
      const message = e.message.slice(0, ANALYTICS_LIMITS.messageChars);
      const backtrace = typeof e.backtrace === "string" ? e.backtrace.slice(0, ANALYTICS_LIMITS.backtraceBytes) : "";
      const fp = typeof e.fingerprint === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(e.fingerprint) ? e.fingerprint : await fingerprint(e.kind, message, backtrace);
      reports.push({ kind: e.kind as string, message, backtrace, fp, top: topFrames(backtrace, 1)[0] ?? "", at: clampAt(e.at, t), session: short(e.session, 64, /^[A-Za-z0-9_-]*$/), context: cleanProps(e.context, ANALYTICS_LIMITS.contextBytes) ?? "{}" });
    }
    if (dryRun) return { dry_run: true, groups: reports.map((r) => r.fp) };

    const db = env.DB;
    const fps = [...new Set(reports.map((r) => r.fp))];
    const existing = await db
      .prepare(`SELECT * FROM error_groups WHERE game_id = ? AND fingerprint IN (${fps.map(() => "?").join(",")})`)
      .bind(game, ...fps)
      .all<GroupRow>();
    const groups = new Map(existing.results.map((g) => [g.fingerprint, g]));
    const stmts: D1PreparedStatement[] = [];
    for (const r of reports) {
      const g: GroupRow = groups.get(r.fp) ?? { game_id: game, fingerprint: r.fp, kind: r.kind, message: r.message.slice(0, 500), top_frame: r.top, first_seen: r.at, last_seen: r.at, count: 0, devices: 0, versions: "[]", platforms: "[]", status: "open", status_at: null };
      g.count++;
      g.first_seen = Math.min(g.first_seen, r.at);
      g.last_seen = Math.max(g.last_seen, r.at);
      g.versions = addTo(g.versions, cx.version);
      g.platforms = addTo(g.platforms, cx.platform);
      // A fixed bug that comes back is open again.
      if (g.status === "fixed") (g.status = "open"), (g.status_at = t);
      groups.set(r.fp, g);
      stmts.push(
        db
          .prepare("INSERT INTO error_samples (game_id, fingerprint, at, device, player_id, session, platform, version, build, backtrace, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(game, r.fp, r.at, cx.device, cx.player, r.session, cx.platform, cx.version, cx.build, r.backtrace, r.context),
      );
    }
    for (const g of groups.values()) {
      stmts.push(db.prepare("INSERT OR IGNORE INTO error_devices (game_id, fingerprint, device) VALUES (?, ?, ?)").bind(game, g.fingerprint, cx.device));
      stmts.push(
        db
          .prepare(
            `INSERT INTO error_groups (game_id, fingerprint, kind, message, top_frame, first_seen, last_seen, count, devices, versions, platforms, status, status_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COUNT(*) FROM error_devices WHERE game_id = ? AND fingerprint = ?), ?, ?, ?, ?)
             ON CONFLICT DO UPDATE SET first_seen = excluded.first_seen, last_seen = excluded.last_seen, count = error_groups.count + ?, devices = excluded.devices,
               versions = excluded.versions, platforms = excluded.platforms, status = excluded.status, status_at = excluded.status_at`,
          )
          .bind(game, g.fingerprint, g.kind, g.message, g.top_frame, g.first_seen, g.last_seen, g.count, game, g.fingerprint, g.versions, g.platforms, g.status, g.status_at, reports.filter((r) => r.fp === g.fingerprint).length),
      );
      stmts.push(
        db
          .prepare("DELETE FROM error_samples WHERE game_id = ? AND fingerprint = ? AND id NOT IN (SELECT id FROM error_samples WHERE game_id = ? AND fingerprint = ? ORDER BY id DESC LIMIT ?)")
          .bind(game, g.fingerprint, game, g.fingerprint, ANALYTICS_LIMITS.samplesKept),
      );
    }
    await db.batch(stmts);
    return { groups: reports.map((r) => r.fp) };
  },

  // ── Reading (developers) ──

  async analyticsSummary({ env, caller, params, query }) {
    await ownGame(env, caller, params.game);
    const f = filters(query);
    const game = params.game;
    const db = env.DB;
    const range = [game, f.from, f.today];
    const [daily, wau, mau, players, sessions, platforms, versions, countries] = await db.batch([
      db
        .prepare(
          `SELECT t.day, COUNT(*) AS dau, SUM(d.first_day = t.day) AS new FROM analytics_active t JOIN analytics_devices d ON d.game_id = t.game_id AND d.device = t.device
           WHERE t.game_id = ? AND t.day BETWEEN ? AND ?${f.where} GROUP BY t.day`,
        )
        .bind(...range, ...f.args),
      db.prepare(`SELECT COUNT(DISTINCT t.device) AS n FROM analytics_active t WHERE t.game_id = ? AND t.day BETWEEN ? AND ?${f.where}`).bind(game, f.today - 6, f.today, ...f.args),
      db.prepare(`SELECT COUNT(DISTINCT t.device) AS n FROM analytics_active t WHERE t.game_id = ? AND t.day BETWEEN ? AND ?${f.where}`).bind(game, f.today - 29, f.today, ...f.args),
      db.prepare(`SELECT COUNT(DISTINCT t.device) AS n FROM analytics_active t WHERE t.game_id = ? AND t.day BETWEEN ? AND ?${f.where}`).bind(...range, ...f.args),
      db.prepare(`SELECT t.day, COALESCE(t.secs, (t.last_at - t.started_at) / 1000.0) AS secs FROM analytics_sessions t WHERE t.game_id = ? AND t.day BETWEEN ? AND ?${f.where} LIMIT 200000`).bind(...range, ...f.args),
      // Breakdowns ignore the filters (they're what the filters choose from).
      db.prepare("SELECT platform AS k, COUNT(DISTINCT device) AS n FROM analytics_active WHERE game_id = ? AND day BETWEEN ? AND ? GROUP BY platform ORDER BY n DESC").bind(...range),
      db.prepare("SELECT version AS k, COUNT(DISTINCT device) AS n FROM analytics_active WHERE game_id = ? AND day BETWEEN ? AND ? GROUP BY version ORDER BY n DESC LIMIT 50").bind(...range),
      db.prepare("SELECT country AS k, COUNT(DISTINCT device) AS n FROM analytics_active WHERE game_id = ? AND day BETWEEN ? AND ? GROUP BY country ORDER BY n DESC LIMIT 50").bind(...range),
    ]);
    const byDay = new Map((daily.results as { day: number; dau: number; new: number }[]).map((r) => [r.day, r]));
    const secsByDay = new Map<number, number[]>();
    for (const s of sessions.results as { day: number; secs: number }[]) {
      if (!secsByDay.has(s.day)) secsByDay.set(s.day, []);
      secsByDay.get(s.day)!.push(s.secs);
    }
    const days = [];
    for (let d = f.from; d <= f.today; d++) {
      const r = byDay.get(d);
      const secs = secsByDay.get(d) ?? [];
      days.push({ day: dayIso(d), dau: r?.dau ?? 0, new: r?.new ?? 0, returning: (r?.dau ?? 0) - (r?.new ?? 0), sessions: secs.length, median_session_secs: round(median(secs)) });
    }
    // Retention: of the devices first seen in the window (early enough to have had day N), how many came back on day N.
    const retention: Record<string, { cohort: number; returned: number; rate: number | null }> = {};
    const ret = await db.batch(
      [1, 7, 30].map((n) =>
        db
          .prepare(
            `SELECT COUNT(*) AS cohort, SUM(EXISTS (SELECT 1 FROM analytics_active r WHERE r.game_id = d.game_id AND r.device = d.device AND r.day = d.first_day + ?)) AS returned
             FROM analytics_devices d JOIN analytics_active t ON t.game_id = d.game_id AND t.device = d.device AND t.day = d.first_day
             WHERE d.game_id = ? AND d.first_day BETWEEN ? AND ?${f.where}`,
          )
          .bind(n, game, f.from, f.today - n, ...f.args),
      ),
    );
    [1, 7, 30].forEach((n, i) => {
      const r = ret[i].results[0] as { cohort: number; returned: number | null };
      const cohort = r?.cohort ?? 0;
      const returned = r?.returned ?? 0;
      retention[`d${n}`] = { cohort, returned, rate: cohort ? round(returned / cohort, 3) : null };
    });
    const allSecs = [...secsByDay.values()].flat();
    const count = (r: D1Result) => Number((r.results[0] as { n: number } | undefined)?.n ?? 0);
    return {
      game,
      range: { from: dayIso(f.from), to: dayIso(f.today), days: f.days },
      players: count(players),
      dau: days[days.length - 1].dau,
      wau: count(wau),
      mau: count(mau),
      sessions: allSecs.length,
      median_session_secs: round(median(allSecs)),
      retention,
      days,
      platforms: platforms.results,
      versions: versions.results,
      countries: countries.results,
    };
  },

  async analyticsEvents({ env, caller, params, query }) {
    await ownGame(env, caller, params.game);
    const f = filters(query);
    const game = params.game;
    const db = env.DB;
    const from = f.from * DAY_MS;
    if (!query.name) {
      const r = await db
        .prepare(`SELECT t.name, COUNT(*) AS n, COUNT(DISTINCT t.device) AS devices FROM events t WHERE t.game_id = ? AND t.at >= ?${f.where} GROUP BY t.name ORDER BY n DESC LIMIT 200`)
        .bind(game, from, ...f.args)
        .all();
      return { range: { from: dayIso(f.from), to: dayIso(f.today) }, names: r.results };
    }
    if (!NAME.test(query.name)) throw bad("name must be an event name");
    if (!query.by) {
      const r = await db
        .prepare(`SELECT t.day, COUNT(*) AS n, COUNT(DISTINCT t.device) AS devices FROM events t WHERE t.game_id = ? AND t.name = ? AND t.day BETWEEN ? AND ?${f.where} GROUP BY t.day`)
        .bind(game, query.name, f.from, f.today, ...f.args)
        .all<{ day: number; n: number; devices: number }>();
      const byDay = new Map(r.results.map((x) => [x.day, x]));
      const days = [];
      for (let d = f.from; d <= f.today; d++) days.push({ day: dayIso(d), n: byDay.get(d)?.n ?? 0, devices: byDay.get(d)?.devices ?? 0 });
      return { name: query.name, range: { from: dayIso(f.from), to: dayIso(f.today) }, total: days.reduce((a, d) => a + d.n, 0), days };
    }
    // Grouped by a prop (a funnel: level_complete by mission) or by a column.
    const columns: Record<string, string> = { platform: "t.platform", version: "t.version", build: "t.build", owned: "t.owned" };
    if (!columns[query.by] && !PROP.test(query.by)) throw bad("by must be a prop name, or platform, version, build or owned");
    const key = columns[query.by] ?? "json_extract(t.props, ?)";
    const keyArgs = columns[query.by] ? [] : [`$.${query.by}`];
    const r = await db
      .prepare(`SELECT ${key} AS k, COUNT(*) AS n, COUNT(DISTINCT t.device) AS devices FROM events t WHERE t.game_id = ? AND t.name = ? AND t.day BETWEEN ? AND ?${f.where} GROUP BY k ORDER BY n DESC LIMIT 500`)
      .bind(...keyArgs, game, query.name, f.from, f.today, ...f.args)
      .all<{ k: unknown; n: number; devices: number }>();
    const rows = r.results.map((x) => ({ value: x.k, n: x.n, devices: x.devices }));
    // Numbers (missions, levels) in order: that's the funnel. Anything else by count.
    if (rows.every((x) => typeof x.value === "number" || x.value === null)) rows.sort((a, b) => (a.value as number ?? Infinity) - (b.value as number ?? Infinity));
    return { name: query.name, by: query.by, range: { from: dayIso(f.from), to: dayIso(f.today) }, total: rows.reduce((a, x) => a + x.n, 0), values: rows };
  },

  async errorsList({ env, caller, params, query }) {
    await ownGame(env, caller, params.game);
    const status = query.status ?? "open";
    if (!["open", "fixed", "ignored", "all"].includes(status)) throw bad("status must be open, fixed, ignored or all");
    let where = "game_id = ?";
    const args: unknown[] = [params.game];
    if (status !== "all") (where += " AND status = ?"), args.push(status);
    if (query.version) (where += " AND EXISTS (SELECT 1 FROM json_each(versions) WHERE value = ?)"), args.push(query.version);
    if (query.platform) (where += " AND EXISTS (SELECT 1 FROM json_each(platforms) WHERE value = ?)"), args.push(query.platform);
    if (query.kind) (where += " AND kind = ?"), args.push(query.kind);
    const sort = query.sort === "count" ? "count DESC" : "last_seen DESC";
    const r = await env.DB.prepare(`SELECT * FROM error_groups WHERE ${where} ORDER BY ${sort} LIMIT 200`)
      .bind(...args)
      .all<GroupRow>();
    return { groups: r.results.map(groupView) };
  },

  async errorsGet({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const g = await env.DB.prepare("SELECT * FROM error_groups WHERE game_id = ? AND fingerprint = ?").bind(params.game, params.fingerprint).first<GroupRow>();
    if (!g) throw notFound(`error group ${params.fingerprint}`, "list them with `partii errors list <game>`");
    const s = await env.DB.prepare("SELECT at, device, player_id, session, platform, version, build, backtrace, context FROM error_samples WHERE game_id = ? AND fingerprint = ? ORDER BY id DESC")
      .bind(params.game, params.fingerprint)
      .all<Record<string, any>>();
    return { group: groupView(g), samples: s.results.map((x) => ({ ...x, player: x.player_id, player_id: undefined, context: JSON.parse(x.context) })) };
  },

  async errorsUpdate({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    if (!["open", "fixed", "ignored"].includes(body.status)) throw bad("status must be open, fixed or ignored", "fixed reopens by itself if the error comes back");
    if (dryRun) return { dry_run: true, status: body.status };
    const r = await env.DB.prepare("UPDATE error_groups SET status = ?, status_at = ? WHERE game_id = ? AND fingerprint = ?").bind(body.status, now(), params.game, params.fingerprint).run();
    if (!r.meta.changes) throw notFound(`error group ${params.fingerprint}`);
    return { fingerprint: params.fingerprint, status: body.status };
  },
};
