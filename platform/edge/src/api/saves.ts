import { files } from "../files";
// Cloud saves: named slots per player per game. Every write names the rev
// it was based on; if another device wrote since, the write is refused with
// both copies so the game can merge and retry. Each write keeps a backup
// revision (the last KEEP stay restorable).

import type { Env } from "../index";
import { ApiError, bad, now } from "./core";
import type { Handlers } from "./index";

const KEEP = 20;
const MAX_SAVE = 2 * 1024 * 1024;
const SLOT = /^[A-Za-z0-9._-]{1,64}$/;

const key = (player: string, game: string, slot: string, rev: number) => `saves/${player}/${game}/${slot}/${rev}`;

async function current(env: Env, player: string, game: string, slot: string) {
  return env.DB.prepare("SELECT slot, rev, size, updated_at FROM saves WHERE player_id = ? AND game_id = ? AND slot = ?").bind(player, game, slot).first<{ slot: string; rev: number; size: number; updated_at: number }>();
}

async function read(env: Env, player: string, game: string, slot: string, rev: number): Promise<unknown> {
  const o = await files(env).get(key(player, game, slot, rev));
  return o ? JSON.parse(await o.text()) : null;
}

async function write(env: Env, player: string, game: string, slot: string, rev: number, text: string) {
  await files(env).put(key(player, game, slot, rev), text, { contentType: "application/json" });
  await env.DB.prepare("INSERT INTO saves (player_id, game_id, slot, rev, size, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at")
    .bind(player, game, slot, rev, text.length, now())
    .run();
  if (rev > KEEP) await files(env).delete(key(player, game, slot, rev - KEEP));
}

function checkSlot(params: Record<string, string>) {
  if (!SLOT.test(params.slot)) throw bad("slot names are 1–64 chars of [A-Za-z0-9._-]");
}

export const saveHandlers: Handlers = {
  async savesList({ env, caller, params }) {
    const r = await env.DB.prepare("SELECT slot, rev, size, updated_at FROM saves WHERE player_id = ? AND game_id = ? ORDER BY slot").bind(caller.player!.id, params.game).all();
    return { saves: r.results };
  },

  async savesGet({ env, caller, params }) {
    checkSlot(params);
    const s = await current(env, caller.player!.id, params.game, params.slot);
    if (!s) throw new ApiError(404, "not_found", "no save in this slot", "write one with PUT");
    return { save: { ...s, data: await read(env, caller.player!.id, params.game, params.slot, s.rev) } };
  },

  async savesPut({ env, caller, params, body }) {
    checkSlot(params);
    if (body.data === undefined) throw bad("data is required");
    const text = JSON.stringify(body.data);
    if (text.length > MAX_SAVE) throw bad("saves are limited to 2 MB");
    const s = await current(env, caller.player!.id, params.game, params.slot);
    const base = body.base_rev === undefined || body.base_rev === null ? 0 : Number(body.base_rev);
    if ((s?.rev ?? 0) !== base) {
      const theirs = s ? { ...s, data: await read(env, caller.player!.id, params.game, params.slot, s.rev) } : null;
      throw new ApiError(409, "conflict", `this save changed on another device (rev ${s?.rev ?? 0}, you started from ${base})`, "merge theirs into yours and write again with base_rev = theirs.rev", {
        theirs,
        yours: body.data,
      });
    }
    const rev = (s?.rev ?? 0) + 1;
    await write(env, caller.player!.id, params.game, params.slot, rev, text);
    return { save: { slot: params.slot, rev, size: text.length, updated_at: now() } };
  },

  async savesHistory({ env, caller, params }) {
    checkSlot(params);
    const s = await current(env, caller.player!.id, params.game, params.slot);
    if (!s) return { revisions: [] };
    const listed = await files(env).list(`saves/${caller.player!.id}/${params.game}/${params.slot}/`);
    const revisions = listed
      .map((o) => ({ rev: Number(o.key.split("/").pop()), size: o.size, at: o.uploaded }))
      .sort((a, b) => b.rev - a.rev);
    return { current: s.rev, revisions };
  },

  async savesRestore({ env, caller, params, body }) {
    checkSlot(params);
    const s = await current(env, caller.player!.id, params.game, params.slot);
    const rev = Number(body.rev);
    const old = s && rev >= 1 ? await files(env).get(key(caller.player!.id, params.game, params.slot, rev)) : null;
    if (!s || !old) throw new ApiError(404, "not_found", `no revision ${rev}`, "list them with savesHistory");
    const next = s.rev + 1;
    await write(env, caller.player!.id, params.game, params.slot, next, await old.text());
    return { save: { slot: params.slot, rev: next, restored_from: rev, updated_at: now() } };
  },

  async contentManifest({ env, params, query }) {
    const row = await env.DB.prepare("SELECT manifest FROM content WHERE game_id = ? AND channel = ?").bind(params.game, String(query.channel ?? "stable")).first<{ manifest: string }>();
    if (!row) throw new ApiError(404, "not_found", "no live content on this channel", "push some with `partii content push`");
    return { manifest: JSON.parse(row.manifest) };
  },

  async contentFile({ env, params }) {
    if (!/^[0-9a-f]{64}$/.test(params.sha)) throw bad("files are addressed by their sha256");
    const o = await files(env).get(`content/${params.game}/${params.sha}`);
    if (!o) throw new ApiError(404, "not_found", "no such content file");
    return new Response(o.body, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  },
};
