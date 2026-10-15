// The operator's view of all of partii: every game's players, sessions, play
// time, errors and sales on one page (adminOverview), the review queue for
// new developers' games, and the developers themselves. Admin token only.

import { ApiError, bad, gameView, now, type GameRow } from "./core";
import type { Handlers } from "./index";
import { siteUrl } from "./web";

const DAY_MS = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY_MS);
const dayIso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

type Row = Record<string, any>;
const byGame = (rows: Row[]) => new Map(rows.map((r) => [r.game_id as string, r]));

export const adminHandlers: Handlers = {
  async adminOverview({ env, query }) {
    const days = Number(query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw bad("days must be 1–90");
    const today = dayOf(now());
    const from = today - (days - 1);
    const fromMs = from * DAY_MS;
    const site = String(query.site ?? env.PLATFORM_GAME ?? "partii");
    const db = env.DB;
    const [games, dau, wau, mau, fresh, sessions, errors, sales, last, daily, dailySessions, devs, pages, refs] = await db.batch<Row>([
      db.prepare(
        `SELECT g.*, d.email AS developer_email, d.name AS developer_name, d.trusted AS developer_trusted
         FROM games g JOIN projects p ON p.id = g.project_id JOIN developers d ON d.id = p.developer_id ORDER BY g.created_at`,
      ),
      db.prepare("SELECT game_id, COUNT(*) AS n FROM analytics_active WHERE day = ? GROUP BY game_id").bind(today),
      db.prepare("SELECT game_id, COUNT(DISTINCT device) AS n FROM analytics_active WHERE day >= ? GROUP BY game_id").bind(today - 6),
      db.prepare("SELECT game_id, COUNT(DISTINCT device) AS n FROM analytics_active WHERE day >= ? GROUP BY game_id").bind(today - 29),
      db.prepare("SELECT game_id, COUNT(*) AS n FROM analytics_devices WHERE first_day >= ? GROUP BY game_id").bind(from),
      db.prepare(
        `SELECT game_id, COUNT(*) AS n, SUM(COALESCE(secs, (last_at - started_at) / 1000)) AS secs
         FROM analytics_sessions WHERE day >= ? GROUP BY game_id`,
      ).bind(from),
      db.prepare(
        `SELECT game_id, SUM(status = 'open') AS open, SUM(status = 'open' AND last_seen >= ?) AS recent, SUM(CASE WHEN last_seen >= ? THEN count ELSE 0 END) AS reports
         FROM error_groups GROUP BY game_id`,
      ).bind(fromMs, fromMs),
      db.prepare("SELECT game_id, COUNT(*) AS n, SUM(amount_cents) AS cents FROM purchases WHERE created_at >= ? AND test = 0 AND status = 'paid' GROUP BY game_id").bind(fromMs),
      db.prepare("SELECT game_id, MAX(day) AS day FROM analytics_active GROUP BY game_id"),
      db.prepare("SELECT day, game_id, COUNT(*) AS n FROM analytics_active WHERE day >= ? GROUP BY day, game_id").bind(from),
      db.prepare("SELECT day, COUNT(*) AS n, SUM(COALESCE(secs, (last_at - started_at) / 1000)) AS secs FROM analytics_sessions WHERE day >= ? GROUP BY day").bind(from),
      db.prepare("SELECT COUNT(*) AS n, SUM(created_at >= ?) AS new, SUM(trusted = 0) AS untrusted FROM developers").bind(fromMs),
      db.prepare(
        `SELECT json_extract(props, '$.path') AS k, COUNT(*) AS n, COUNT(DISTINCT device) AS devices
         FROM events WHERE game_id = ? AND name = 'page_view' AND day >= ? GROUP BY k ORDER BY n DESC LIMIT 15`,
      ).bind(site, from),
      db.prepare(
        `SELECT json_extract(props, '$.ref') AS k, COUNT(*) AS n FROM events
         WHERE game_id = ? AND name = 'session_start' AND day >= ? GROUP BY k ORDER BY n DESC LIMIT 15`,
      ).bind(site, from),
    ]);
    const m = { dau: byGame(dau.results), wau: byGame(wau.results), mau: byGame(mau.results), fresh: byGame(fresh.results), sessions: byGame(sessions.results), errors: byGame(errors.results), sales: byGame(sales.results), last: byGame(last.results) };
    const rows = games.results.map((g) => {
      const s = m.sessions.get(g.id);
      const e = m.errors.get(g.id);
      const p = m.sales.get(g.id);
      const lastDay = m.last.get(g.id)?.day;
      return {
        id: g.id,
        title: g.title,
        project: g.project_id,
        status: g.status,
        review: gameView(g as GameRow).review,
        developer: { email: g.developer_email, name: g.developer_name, trusted: !!g.developer_trusted },
        dau: m.dau.get(g.id)?.n ?? 0,
        wau: m.wau.get(g.id)?.n ?? 0,
        mau: m.mau.get(g.id)?.n ?? 0,
        new_players: m.fresh.get(g.id)?.n ?? 0,
        sessions: s?.n ?? 0,
        play_secs: Math.round(s?.secs ?? 0),
        avg_session_secs: s?.n ? Math.round((s.secs ?? 0) / s.n) : null,
        errors_open: e?.open ?? 0,
        errors_recent: e?.recent ?? 0,
        error_reports: e?.reports ?? 0,
        purchases: p?.n ?? 0,
        revenue_cents: p?.cents ?? 0,
        last_active: lastDay !== undefined ? dayIso(lastDay) : null,
      };
    });
    // Every day in the range, all games together and per game.
    const series = Array.from({ length: days }, (_, i) => ({ day: dayIso(from + i), players: 0, sessions: 0, play_secs: 0, by_game: {} as Record<string, number> }));
    for (const r of daily.results) {
      const d = series[r.day - from];
      if (!d) continue;
      d.players += r.n;
      d.by_game[r.game_id] = r.n;
    }
    for (const r of dailySessions.results) {
      const d = series[r.day - from];
      if (d) (d.sessions = r.n), (d.play_secs = Math.round(r.secs ?? 0));
    }
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const dev = devs.results[0] ?? {};
    return {
      range: { from: dayIso(from), to: dayIso(today), days },
      totals: {
        games: rows.length,
        published: rows.filter((r) => r.status === "published").length,
        in_review: rows.filter((r) => r.review?.status === "pending").length,
        developers: dev.n ?? 0,
        developers_new: dev.new ?? 0,
        developers_untrusted: dev.untrusted ?? 0,
        players_today: sum("dau"),
        sessions: sum("sessions"),
        play_secs: sum("play_secs"),
        errors_open: sum("errors_open"),
        purchases: sum("purchases"),
        revenue_cents: sum("revenue_cents"),
      },
      games: rows,
      daily: series,
      site: { game: site, pages: pages.results, referrers: refs.results.map((r) => ({ ...r, k: r.k || "(direct)" })) },
    };
  },

  // ── Review: new developers' games before they go on the store ──

  async adminGamesReview({ env, query }) {
    const all = query.status === "all";
    const r = await env.DB.prepare(
      `SELECT g.*, d.email AS developer_email, d.name AS developer_name, d.created_at AS developer_since
       FROM games g JOIN projects p ON p.id = g.project_id JOIN developers d ON d.id = p.developer_id
       WHERE ${all ? "g.review IS NOT NULL" : "g.review = 'pending'"} ORDER BY g.review_at LIMIT 200`,
    ).all<GameRow & Row>();
    const ids = r.results.map((g) => g.id);
    const sites = ids.length
      ? await env.DB.prepare(`SELECT game_id, deploy_id FROM web_sites WHERE game_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ game_id: string; deploy_id: string }>()
      : { results: [] };
    const live = new Map(sites.results.map((s) => [s.game_id, s.deploy_id]));
    return {
      games: r.results.map((g) => ({
        ...gameView(g),
        developer: { email: g.developer_email, name: g.developer_name, since: g.developer_since },
        // The site as it is now, at its preview address (the main one opens on approval).
        site_preview: live.has(g.id) ? siteUrl(env, g.id, live.get(g.id)) : null,
      })),
    };
  },

  async adminGamesDecide({ env, params, body, dryRun }) {
    const verdict = String(body.verdict ?? "");
    if (verdict !== "approve" && verdict !== "reject") throw bad("verdict is approve or reject");
    const note = String(body.note ?? "").slice(0, 1000);
    if (verdict === "reject" && !note.trim()) throw bad("say why in note: the developer (and their agent) reads it to fix the game");
    const g = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(params.game).first<GameRow>();
    if (!g) throw new ApiError(404, "not_found", `no game ${params.game}`);
    const review = verdict === "approve" ? "approved" : "rejected";
    // Approving a game that asked to publish puts it on the store.
    const status = verdict === "approve" && g.review === "pending" ? "published" : verdict === "reject" ? "draft" : g.status;
    const next = { ...g, review, review_note: note, review_at: now(), status };
    if (dryRun) return { dry_run: true, game: gameView(next) };
    await env.DB.prepare("UPDATE games SET review = ?, review_note = ?, review_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(review, note, next.review_at, status, now(), g.id).run();
    return { game: gameView(next) };
  },

  // ── Developers ──

  async adminDevelopersList({ env }) {
    const r = await env.DB.prepare(
      `SELECT d.id, d.email, d.name, d.trusted, d.signup, d.created_at,
         (SELECT COUNT(*) FROM projects p WHERE p.developer_id = d.id) AS projects,
         (SELECT COUNT(*) FROM games g JOIN projects p ON p.id = g.project_id WHERE p.developer_id = d.id) AS games,
         (SELECT MAX(t.created_at) FROM dev_tokens t WHERE t.developer_id = d.id) AS last_token_at
       FROM developers d ORDER BY d.created_at DESC LIMIT 500`,
    ).all<Row>();
    return { developers: r.results.map((d) => ({ ...d, trusted: !!d.trusted })) };
  },

  async adminDevelopersTrust({ env, params, body, dryRun }) {
    if (typeof body.trusted !== "boolean") throw bad("trusted is true or false");
    const d = await env.DB.prepare("SELECT id, email FROM developers WHERE id = ? OR email = ?").bind(params.developer, params.developer.toLowerCase()).first<{ id: string; email: string }>();
    if (!d) throw new ApiError(404, "not_found", `no developer ${params.developer}`, "use the id or email from partii admin developers list");
    if (dryRun) return { dry_run: true, developer: { ...d, trusted: body.trusted } };
    await env.DB.prepare("UPDATE developers SET trusted = ? WHERE id = ?").bind(body.trusted ? 1 : 0, d.id).run();
    return { developer: { ...d, trusted: body.trusted } };
  },
};
