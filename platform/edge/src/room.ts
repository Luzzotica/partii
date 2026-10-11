// Room DO: one per live room, named `<project>:<code>`. It owns membership
// (member ids, kinds, seats held through a suspension) and tells member
// sessions about changes. Signals and relayed packets never pass through
// it; sessions send those to each other directly (docs/DESIGN.md).

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { DEFAULT_MAX_MEMBERS, MAX_MEMBERS, type Joined, type Member, ProtoError, type RoomView } from "./protocol";

interface MemberRec extends Member {
  conn: string;
}

interface RoomState {
  code: string;
  project: string;
  game: string;
  host: number;
  maxMembers: number;
  joinable: boolean;
  meta: unknown;
  nextMid: number;
  members: Record<number, MemberRec>;
  createdAt: number;
}

export interface MemberArgs {
  conn: string;
  kind: string;
  name: string;
  meta: unknown;
}

type Result<T> = { ok: true; value: T } | { ok: false; code: ProtoError["code"]; message: string };

const fail = (e: unknown): Result<never> =>
  e instanceof ProtoError ? { ok: false, code: e.code, message: e.message } : { ok: false, code: "internal", message: String(e) };

export class Room extends DurableObject<Env> {
  private state: RoomState | null | undefined;

  private load(): RoomState | null {
    if (this.state === undefined) this.state = (this.ctx.storage.kv.get("room") as RoomState | undefined) ?? null;
    return this.state;
  }
  private save(s: RoomState | null) {
    this.state = s;
    if (s) this.ctx.storage.kv.put("room", s);
    else this.ctx.storage.kv.delete("room");
  }

  private view(s: RoomState, you: number): RoomView {
    return {
      code: s.code,
      game: s.game,
      host: s.host,
      you,
      joinable: s.joinable,
      max_members: s.maxMembers,
      meta: s.meta,
      members: Object.values(s.members).map(({ conn: _conn, ...m }) => m),
    };
  }
  private joined(s: RoomState, you: number): Joined {
    const conns: Record<number, string> = {};
    for (const m of Object.values(s.members)) conns[m.mid] = m.conn;
    return { room: this.view(s, you), conns };
  }

  /** Tell every member except `skip` (best effort, in parallel). */
  private tell(s: RoomState, ev: Record<string, unknown>, skip?: number) {
    for (const m of Object.values(s.members)) {
      if (m.mid === skip) continue;
      const stub = this.env.SESSION.get(this.env.SESSION.idFromName(m.conn));
      stub.deliver(ev).catch(() => {});
    }
  }

  async init(args: { code: string; project: string; game: string; maxMembers?: number; meta?: unknown; host: MemberArgs }): Promise<Result<Joined>> {
    try {
      const existing = this.load();
      if (existing) throw new ProtoError("closed", "code taken");
      const max = Math.min(Math.max(args.maxMembers ?? DEFAULT_MAX_MEMBERS, 1), MAX_MEMBERS);
      const host: MemberRec = { mid: 1, status: "active", ...args.host };
      const s: RoomState = {
        code: args.code,
        project: args.project,
        game: args.game,
        host: 1,
        maxMembers: max,
        joinable: true,
        meta: args.meta ?? null,
        nextMid: 2,
        members: { 1: host },
        createdAt: Date.now(),
      };
      this.save(s);
      return { ok: true, value: this.joined(s, 1) };
    } catch (e) {
      return fail(e);
    }
  }

  async join(args: MemberArgs & { project: string }): Promise<Result<Joined>> {
    try {
      const s = this.load();
      if (!s || s.project !== args.project) throw new ProtoError("not_found", "no room with that code");
      // A session re-joining (for example after a reconnect race) keeps its seat.
      const again = Object.values(s.members).find((m) => m.conn === args.conn);
      if (again) return { ok: true, value: this.joined(s, again.mid) };
      if (!s.joinable) throw new ProtoError("not_joinable", "the host closed the room to new players");
      if (Object.keys(s.members).length >= s.maxMembers) throw new ProtoError("full", "the room is full");
      const m: MemberRec = { mid: s.nextMid++, status: "active", ...args };
      s.members[m.mid] = m;
      this.save(s);
      const { conn, ...pub } = m;
      this.tell(s, { t: "member_joined", member: pub, _conn: conn }, m.mid);
      return { ok: true, value: this.joined(s, m.mid) };
    } catch (e) {
      return fail(e);
    }
  }

  async leave(mid: number, reason: "left" | "kicked" | "timeout"): Promise<Result<null>> {
    const s = this.load();
    if (!s || !s.members[mid]) return { ok: true, value: null };
    if (mid === s.host) {
      delete s.members[mid];
      this.tell(s, { t: "room_closed", reason: "host_left" });
      this.save(null);
      return { ok: true, value: null };
    }
    delete s.members[mid];
    this.save(s);
    this.tell(s, { t: "member_left", mid, reason });
    return { ok: true, value: null };
  }

  async setStatus(mid: number, status: "active" | "suspended"): Promise<void> {
    const s = this.load();
    const m = s?.members[mid];
    if (!s || !m || m.status === status) return;
    m.status = status;
    this.save(s);
    this.tell(s, { t: status === "suspended" ? "member_suspended" : "member_resumed", mid }, mid);
  }

  async update(mid: number, patch: { joinable?: boolean; meta?: unknown; maxMembers?: number }): Promise<Result<RoomView>> {
    try {
      const s = this.load();
      if (!s || !s.members[mid]) throw new ProtoError("not_in_room", "not in this room");
      if (s.host !== mid) throw new ProtoError("not_host", "only the host can change the room");
      if (typeof patch.joinable === "boolean") s.joinable = patch.joinable;
      if (patch.meta !== undefined) s.meta = patch.meta;
      if (typeof patch.maxMembers === "number") s.maxMembers = Math.min(Math.max(patch.maxMembers, Object.keys(s.members).length), MAX_MEMBERS);
      this.save(s);
      for (const m of Object.values(s.members)) {
        if (m.mid === mid) continue;
        this.env.SESSION.get(this.env.SESSION.idFromName(m.conn)).deliver({ t: "room_updated", room: this.view(s, m.mid) }).catch(() => {});
      }
      return { ok: true, value: this.view(s, mid) };
    } catch (e) {
      return fail(e);
    }
  }

  async kick(mid: number, target: number): Promise<Result<null>> {
    const s = this.load();
    if (!s || s.host !== mid) return fail(new ProtoError("not_host", "only the host can kick"));
    const m = s.members[target];
    if (!m || target === mid) return fail(new ProtoError("not_found", "no such member"));
    this.env.SESSION.get(this.env.SESSION.idFromName(m.conn)).kicked().catch(() => {});
    return this.leave(target, "kicked");
  }

  /** The room as member `mid` sees it (for a resumed session's welcome). */
  async viewFor(mid: number): Promise<Joined | null> {
    const s = this.load();
    return s && s.members[mid] ? this.joined(s, mid) : null;
  }

  /** For tests and the CLI: the room as stored. */
  async inspect(): Promise<RoomState | null> {
    return this.load();
  }
}
