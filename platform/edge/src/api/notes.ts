// Patch notes: a developer publishes one markdown post per version of a game
// (idempotent: publishing the same version again updates it); anyone reads
// them, and the store shows them at /games/<game>/updates/<version>.

import type { Env } from "../index";
import { ApiError, bad, notFound, now, ownGame } from "./core";
import type { Handlers } from "./index";

export const NOTES_LIMITS = { markdownBytes: 64 * 1024, titleChars: 120, page: 50 };
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface NoteRow {
  game_id: string;
  version: string;
  title: string;
  markdown: string;
  published_at: number;
  updated_at: number;
}

const storeBase = (env: Env) => (env.STORE_URL ?? "https://partii.games").replace(/\/$/, "");

/** The store page for a game's notes (a version's, or the index). */
export const notesUrl = (env: Env, game: string, version?: string) =>
  `${storeBase(env)}/games/${encodeURIComponent(game)}/updates${version ? `/${encodeURIComponent(version)}` : ""}`;

/** The opening lines' text (headings skipped, bullets joined with " · "), for lists and link previews. */
function excerpt(md: string, max = 200): string {
  const parts = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^(-{3,}|\*{3,})$/.test(l))
    .map((l) =>
      l
        .replace(/^([-*+]|\d+[.)])\s+/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim(),
    )
    .filter(Boolean);
  let text = "";
  for (const p of parts) {
    if (text.length >= max) break;
    text = text ? `${text} · ${p}` : p;
  }
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function view(env: Env, r: NoteRow, full: boolean) {
  return {
    game: r.game_id,
    version: r.version,
    title: r.title,
    published_at: r.published_at,
    updated_at: r.updated_at,
    excerpt: excerpt(r.markdown),
    url: notesUrl(env, r.game_id, r.version),
    ...(full ? { markdown: r.markdown } : {}),
  };
}

function version(v: unknown): string {
  const s = String(v ?? "");
  if (!VERSION.test(s)) throw bad("version is 1–40 letters, digits and . _ + - (e.g. 0.4.278)");
  return s;
}

async function publishedGame(env: Env, game: string) {
  const g = await env.DB.prepare("SELECT id, title FROM games WHERE id = ? AND status = 'published'").bind(game).first<{ id: string; title: string }>();
  if (!g) throw new ApiError(404, "not_found", `no published game ${game}`);
  return g;
}

/** The newest note, for the game's store page. */
export async function latestNote(env: Env, game: string) {
  const r = await env.DB.prepare("SELECT * FROM game_notes WHERE game_id = ? ORDER BY published_at DESC, version DESC LIMIT 1").bind(game).first<NoteRow>();
  return r ? view(env, r, false) : null;
}

export const notesHandlers: Handlers = {
  async notesPut({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const v = version(params.version);
    const markdown = String(body.markdown ?? "").replace(/\r\n/g, "\n").trim();
    if (!markdown) throw bad("markdown is the notes (markdown text)", "partii notes publish <game> <version> --markdown @notes.md");
    if (new TextEncoder().encode(markdown).byteLength > NOTES_LIMITS.markdownBytes) throw bad(`markdown is at most ${NOTES_LIMITS.markdownBytes / 1024} KB`);
    const title = String(body.title ?? "").trim() || `${g.title} ${v}`;
    if (title.length > NOTES_LIMITS.titleChars) throw bad(`title is at most ${NOTES_LIMITS.titleChars} characters`);
    let date: number | undefined;
    if (body.date !== undefined && body.date !== null && body.date !== "") {
      if (!DATE.test(String(body.date))) throw bad("date is YYYY-MM-DD (the release day, UTC)");
      date = Date.parse(`${body.date}T12:00:00Z`);
      if (Number.isNaN(date)) throw bad("date is YYYY-MM-DD (the release day, UTC)");
    }
    const existing = await env.DB.prepare("SELECT * FROM game_notes WHERE game_id = ? AND version = ?").bind(g.id, v).first<NoteRow>();
    const t = now();
    const row: NoteRow = { game_id: g.id, version: v, title, markdown, published_at: date ?? existing?.published_at ?? t, updated_at: t };
    if (dryRun) return { dry_run: true, note: view(env, row, true), created: !existing };
    await env.DB.prepare(
      "INSERT INTO game_notes (game_id, version, title, markdown, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (game_id, version) DO UPDATE SET title = excluded.title, markdown = excluded.markdown, published_at = excluded.published_at, updated_at = excluded.updated_at",
    )
      .bind(row.game_id, row.version, row.title, row.markdown, row.published_at, row.updated_at)
      .run();
    return { note: view(env, row, true), created: !existing, url: view(env, row, false).url, index_url: notesUrl(env, g.id) };
  },

  async notesDelete({ env, caller, params, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const v = version(params.version);
    const existing = await env.DB.prepare("SELECT 1 FROM game_notes WHERE game_id = ? AND version = ?").bind(g.id, v).first();
    if (!existing) throw notFound(`notes for ${g.id} ${v}`);
    if (dryRun) return { dry_run: true, deleted: true };
    await env.DB.prepare("DELETE FROM game_notes WHERE game_id = ? AND version = ?").bind(g.id, v).run();
    return { deleted: true };
  },

  async storeNotes({ env, params, query }) {
    const g = await publishedGame(env, params.game);
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), NOTES_LIMITS.page);
    const before = query.before !== undefined ? Number(query.before) : null;
    if (before !== null && !Number.isFinite(before)) throw bad("before is the next_before of a previous page");
    const r = await env.DB.prepare(`SELECT * FROM game_notes WHERE game_id = ?${before !== null ? " AND published_at < ?" : ""} ORDER BY published_at DESC, version DESC LIMIT ?`)
      .bind(...(before !== null ? [g.id, before, limit + 1] : [g.id, limit + 1]))
      .all<NoteRow>();
    const rows = r.results.slice(0, limit);
    return { game: { id: g.id, title: g.title }, notes: rows.map((x) => view(env, x, false)), next_before: r.results.length > limit ? rows[rows.length - 1].published_at : null, url: notesUrl(env, g.id) };
  },

  async storeNote({ env, params }) {
    const g = await publishedGame(env, params.game);
    const r = await env.DB.prepare("SELECT * FROM game_notes WHERE game_id = ? AND version = ?").bind(g.id, String(params.version ?? "")).first<NoteRow>();
    if (!r) throw notFound(`notes for ${g.id} ${params.version}`);
    return { game: { id: g.id, title: g.title }, note: view(env, r, true) };
  },
};
