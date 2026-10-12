// Session DO: one per client launch (named by its conn id), holding the
// client's one socket. It answers create/join without a database, routes
// signals and relayed packets straight to other members' sessions, and
// survives a dropped socket for GRACE_MS: the seat is held, events are
// buffered, and a reconnect with the same conn id resumes (docs/PROTOCOL.md).

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { type IceGrant, mintIce } from "./ice";
import { verifyKey } from "./keys";
import { allowed, Bucket, type LimitKind, RELAY_BURST, RELAY_RATE } from "./limits";
import { usage } from "./usage";
import {
  BROADCAST,
  BUFFER_LIMIT,
  DEFAULT_MAX_MEMBERS,
  MAX_MEMBERS,
  GRACE_MS,
  type Joined,
  MAX_RELAY_BYTES,
  newCode,
  normalizeCode,
  PROTOCOL_VERSION,
  ProtoError,
  RELAY_BUNDLE,
  RELAY_FRAME,
  str,
} from "./protocol";

interface SessState {
  conn: string;
  project: string;
  keyId: string;
  client?: string;
  room?: { code: string; mid: number };
  /** A warm room made ahead of time, so `create` skips a cold start. */
  reserved?: string;
  conns: Record<number, string>;
  ice?: IceGrant;
  disconnectedAt?: number;
}

type Msg = Record<string, unknown> & { t?: unknown; id?: unknown };
type Attachment = { hello: boolean; conn: string; ip: string };

/** Close code for a socket refused by a rate limit (clients back off and retry). */
export const CLOSE_RATE_LIMITED = 4029;
/** Dropped relay deliveries are reported to usage at most this often. */
const RELAY_REPORT_MS = 10_000;

const ICE_REFRESH_LEAD_MS = 10 * 60_000;

type RoomResult<T> = { ok: boolean; value?: T; code?: ProtoError["code"]; message?: string };
function unwrap<T>(r: RoomResult<T>): T {
  if (!r.ok) throw new ProtoError(r.code ?? "internal", r.message ?? "room error");
  return r.value as T;
}

export class Session extends DurableObject<Env> {
  private st: SessState | null | undefined;
  private reserving: Promise<void> | null = null;
  private relayBudget = new Bucket(RELAY_RATE, RELAY_BURST);
  private relayDropped = 0;
  private relayReportedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive answered by the runtime without waking the object: clients
    // send "ping" each second and treat silence as a dead socket.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private load(): SessState | null {
    if (this.st === undefined) this.st = (this.ctx.storage.kv.get("s") as SessState | undefined) ?? null;
    return this.st;
  }
  private save(s: SessState | null) {
    this.st = s;
    if (s) this.ctx.storage.kv.put("s", s);
    else this.ctx.storage.kv.delete("s");
  }
  private socket(): WebSocket | undefined {
    return this.ctx.getWebSockets()[0];
  }
  private grace(): number {
    return Number(this.env.GRACE_MS ?? GRACE_MS);
  }
  private roomStub(s: SessState, code = s.room?.code) {
    return this.env.ROOM.get(this.env.ROOM.idFromName(`${s.project}:${code}`));
  }
  private peer(conn: string) {
    return this.env.SESSION.get(this.env.SESSION.idFromName(conn));
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    for (const old of this.ctx.getWebSockets()) old.close(4000, "replaced by a newer connection");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const att: Attachment = { hello: false, conn: new URL(req.url).searchParams.get("conn") ?? "", ip: req.headers.get("cf-connecting-ip") ?? "" };
    pair[1].serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ── Socket events ──

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string") return this.relayOut(ws, data);
    let msg: Msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return this.send(ws, { t: "err", code: "bad_request", message: "frames must be JSON objects" });
    }
    const helloDone = (ws.deserializeAttachment() as Attachment | null)?.hello;
    if (!helloDone && msg.t !== "hello") {
      return this.send(ws, { t: "err", id: msg.id, code: "unauthorized", message: "send hello first" });
    }
    try {
      const reply = await this.handle(ws, msg);
      if (reply && msg.id !== undefined) this.send(ws, { t: "ok", id: msg.id, ...reply });
    } catch (e) {
      const pe = e instanceof ProtoError ? e : new ProtoError("internal", String(e));
      this.send(ws, { t: "err", id: msg.id, code: pe.code, message: pe.message });
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.disconnected(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.disconnected(ws);
  }

  private async disconnected(ws: WebSocket) {
    // A replaced socket closing is not a disconnect.
    if (this.ctx.getWebSockets().some((w) => w !== ws)) return;
    const s = this.load();
    if (!s) return;
    s.disconnectedAt = Date.now();
    this.save(s);
    if (s.room) await this.roomStub(s).setStatus(s.room.mid, "suspended");
    await this.schedule();
  }

  async alarm() {
    const s = this.load();
    if (!s) return;
    const now = Date.now();
    // Disconnected and not resumed (a hello clears disconnectedAt): the grace
    // window decides, whatever sockets are still listed.
    if (s.disconnectedAt !== undefined) {
      if (now - s.disconnectedAt >= this.grace()) {
        if (s.room) await this.roomStub(s).leave(s.room.mid, "timeout");
        if (s.reserved) await this.roomStub(s, s.reserved).release(s.conn);
        usage(this.env, s.project).down("session", s.conn).catch(() => {});
        this.save(null);
        this.ctx.storage.kv.delete("buf");
        return;
      }
    } else if (s.ice && s.ice.ice_expires_at - now < ICE_REFRESH_LEAD_MS) {
      s.ice = await mintIce(this.env);
      this.save(s);
      // Still alive: keeps the session counted (usage drops rows not seen for hours).
      usage(this.env, s.project).up(s.project, "session", s.conn).catch(() => {});
      const ws = this.socket();
      if (ws) this.send(ws, { t: "ice", ice_servers: s.ice.ice_servers, ice_expires_at: s.ice.ice_expires_at, relay: s.ice.relay });
    }
    await this.schedule();
  }

  private async schedule() {
    const s = this.load();
    if (!s) return;
    const times: number[] = [];
    // Not `!this.socket()`: inside webSocketClose the closing socket is still
    // listed, which used to push a no-room session's teardown out to the relay
    // credential refresh (hours) instead of the grace window.
    if (s.disconnectedAt !== undefined) times.push(s.disconnectedAt + this.grace());
    else if (s.ice) times.push(s.ice.ice_expires_at - ICE_REFRESH_LEAD_MS);
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Math.min(...times), Date.now() + 10));
  }

  // ── Requests ──

  private async handle(ws: WebSocket, m: Msg): Promise<Record<string, unknown> | null> {
    switch (m.t) {
      case "hello":
        return this.hello(ws, m);
      case "create":
        await this.limit(ws, "create");
        return this.create(m);
      case "join":
        await this.limit(ws, "join");
        return this.join(m);
      case "leave": {
        const s = this.need();
        if (s.room) await this.roomStub(s).leave(s.room.mid, "left");
        s.room = undefined;
        s.conns = {};
        this.save(s);
        this.reserveSoon();
        return {};
      }
      case "update": {
        const s = this.inRoom();
        const r = (await this.roomStub(s).update(s.room!.mid, {
          joinable: typeof m.joinable === "boolean" ? m.joinable : undefined,
          meta: m.meta,
          maxMembers: typeof m.max_members === "number" ? m.max_members : undefined,
        })) as RoomResult<unknown>;
        return { room: unwrap(r) };
      }
      case "kick": {
        const s = this.inRoom();
        unwrap((await this.roomStub(s).kick(s.room!.mid, Number(m.mid))) as RoomResult<null>);
        return {};
      }
      case "signal": {
        const s = this.inRoom();
        const conn = s.conns[Number(m.to)];
        if (!conn) throw new ProtoError("not_found", `no member ${String(m.to)}`);
        this.peer(conn).deliver({ t: "signal", from: s.room!.mid, data: m.data }).catch(() => {});
        return null;
      }
      case "ping":
        return { server_time: Date.now() };
      case "report": {
        // Connection timings from the client, recorded off the live path.
        const s = this.need();
        const metrics = typeof m.metrics === "object" && m.metrics ? JSON.stringify(m.metrics).slice(0, 4000) : null;
        if (metrics) {
          this.env.DB.prepare("INSERT INTO timings (project_id, metrics, created_at) VALUES (?, ?, ?)").bind(s.project, metrics, Date.now()).run().catch(() => {});
        }
        return null;
      }
      default:
        throw new ProtoError("bad_request", `unknown message type ${JSON.stringify(m.t)}`);
    }
  }

  /** Refuse with `rate_limited` when this client's IP is over its limit. */
  private async limit(ws: WebSocket, kind: LimitKind) {
    const ip = (ws.deserializeAttachment() as Attachment).ip;
    if (await allowed(this.env, kind, ip)) return;
    const s = this.load();
    if (s) usage(this.env, s.project).hit(s.project, kind).catch(() => {});
    throw new ProtoError("rate_limited", `too many ${kind === "create" ? "rooms created" : "joins"} from this network; try again in a minute`);
  }

  private need(): SessState {
    const s = this.load();
    if (!s) throw new ProtoError("unauthorized", "send hello first");
    return s;
  }
  private inRoom(): SessState {
    const s = this.need();
    if (!s.room) throw new ProtoError("not_in_room", "not in a room");
    return s;
  }

  private async hello(ws: WebSocket, m: Msg) {
    if (m.v !== PROTOCOL_VERSION) throw new ProtoError("bad_request", `protocol v${PROTOCOL_VERSION} only`);
    const claims = await verifyKey(this.env.KEY_SECRET, m.key);
    if (!claims) throw new ProtoError("unauthorized", "bad publishable key");
    const { conn, ip } = ws.deserializeAttachment() as Attachment;
    let s = this.load();
    let resumed = false;
    let room: Joined["room"] | undefined;
    if (s && s.project === claims.project) {
      resumed = true;
      s.disconnectedAt = undefined;
      if (s.room) {
        const j = (await this.roomStub(s).viewFor(s.room.mid)) as Joined | null;
        if (j) {
          room = j.room;
          s.conns = j.conns;
          await this.roomStub(s).setStatus(s.room.mid, "active");
        } else {
          s.room = undefined;
          s.conns = {};
        }
      }
    } else {
      // A new session mints relay credentials and warms a room: limited per IP.
      // The socket is closed so the client backs off and retries.
      if (!(await allowed(this.env, "session", ip))) {
        usage(this.env, claims.project).hit(claims.project, "session").catch(() => {});
        this.send(ws, { t: "err", code: "rate_limited", message: "too many new connections from this network; try again in a minute" });
        ws.close(CLOSE_RATE_LIMITED, "rate_limited");
        return null;
      }
      s = { conn, project: claims.project, keyId: claims.keyId, conns: {} };
      usage(this.env, s.project).up(s.project, "session", conn).catch(() => {});
    }
    s.client = str(m.client, 120);
    if (!s.ice || s.ice.ice_expires_at - Date.now() < ICE_REFRESH_LEAD_MS) s.ice = await mintIce(this.env);
    this.save(s);
    ws.serializeAttachment({ hello: true, conn, ip } satisfies Attachment);
    this.send(ws, {
      t: "welcome",
      conn: s.conn,
      project: s.project,
      resumed,
      ice_servers: s.ice.ice_servers,
      ice_expires_at: s.ice.ice_expires_at,
      relay: s.ice.relay,
      server_time: Date.now(),
      ...(room ? { room } : {}),
    });
    // Events that arrived while the socket was down, in order.
    const buf = (this.ctx.storage.kv.get("buf") as string[] | undefined) ?? [];
    for (const f of buf) ws.send(f);
    this.ctx.storage.kv.delete("buf");
    await this.schedule();
    this.reserveSoon();
    return null;
  }

  /** Make a warm room in the background (not on any request's path). */
  private reserveSoon() {
    const s = this.load();
    if (!s || s.room || s.reserved || this.reserving) return;
    this.reserving = (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = newCode();
        const r = (await this.roomStub(s, code).init({
          code,
          project: s.project,
          game: "",
          host: { conn: s.conn, kind: "game", name: "", meta: null },
          reserved: true,
        })) as RoomResult<Joined>;
        if (r.ok) {
          const cur = this.load();
          if (cur && !cur.room && !cur.reserved) {
            cur.reserved = code;
            this.save(cur);
          } else {
            await this.roomStub(s, code).release(s.conn);
          }
          return;
        }
      }
    })()
      .catch(() => {})
      .finally(() => (this.reserving = null));
  }

  private async create(m: Msg) {
    const t0 = Date.now();
    const s = this.need();
    if (s.room) throw new ProtoError("already_in_room", "leave your room first");
    const game = str(m.game);
    if (!game) throw new ProtoError("bad_request", "game is required");
    const host = { conn: s.conn, kind: str(m.kind, 16) ?? "game", name: str(m.name) ?? "", meta: m.meta ?? null };
    // A reservation on its way is quicker than a second cold room.
    if (!s.reserved && this.reserving) {
      await this.reserving;
      Object.assign(s, this.load());
    }
    if (s.reserved) {
      // The warm room is ours: answer now, claim it in the background. A
      // join that beats the claim gets "reserved" and is retried.
      const code = s.reserved;
      s.reserved = undefined;
      const maxMembers = Math.min(Math.max(typeof m.max_members === "number" ? m.max_members : DEFAULT_MAX_MEMBERS, 1), MAX_MEMBERS);
      const room = { code, game, host: 1, you: 1, joinable: true, max_members: maxMembers, meta: m.meta ?? null, members: [{ mid: 1, kind: host.kind, name: host.name, meta: host.meta, status: "active" as const }] };
      const entered = this.entered(s, code, { room, conns: { 1: s.conn } });
      this.roomStub(s, code)
        .claim({ conn: s.conn, game, maxMembers, meta: m.meta, host })
        .catch(() => {});
      return { ...entered, server_ms: Date.now() - t0, warm: true };
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newCode();
      const r = (await this.roomStub(s, code).init({
        code,
        project: s.project,
        game,
        maxMembers: typeof m.max_members === "number" ? m.max_members : undefined,
        meta: m.meta,
        host,
      })) as RoomResult<Joined>;
      if (r.ok) return { ...this.entered(s, code, r.value as Joined), server_ms: Date.now() - t0 };
      if (r.code !== "closed") unwrap(r);
    }
    throw new ProtoError("internal", "could not find a free room code");
  }

  private async join(m: Msg) {
    const t0 = Date.now();
    const s = this.need();
    if (s.room) throw new ProtoError("already_in_room", "leave your room first");
    const code = normalizeCode(m.code);
    if (!code) throw new ProtoError("bad_request", "code must be 4–8 letters");
    const args = { project: s.project, conn: s.conn, kind: str(m.kind, 16) ?? "game", name: str(m.name) ?? "", meta: m.meta ?? null };
    let r = (await this.roomStub(s, code).join(args)) as RoomResult<Joined>;
    for (let i = 0; i < 5 && !r.ok && (r.code as string) === "reserved"; i++) {
      await new Promise((ok) => setTimeout(ok, 40));
      r = (await this.roomStub(s, code).join(args)) as RoomResult<Joined>;
    }
    if (!r.ok && (r.code as string) === "reserved") r = { ok: false, code: "not_found", message: "no room with that code" };
    return { ...this.entered(s, code, unwrap(r)), server_ms: Date.now() - t0 };
  }

  private entered(s: SessState, code: string, j: Joined) {
    s.room = { code, mid: j.room.you };
    s.conns = j.conns;
    this.save(s);
    return { room: j.room };
  }

  // ── Relay ──

  private relayOut(_ws: WebSocket, data: ArrayBuffer) {
    const s = this.load();
    if (!s?.room || data.byteLength < 3 || data.byteLength > MAX_RELAY_BYTES + 3) return;
    const v = new DataView(data);
    const kind = v.getUint8(0);
    if (kind !== RELAY_FRAME && kind !== RELAY_BUNDLE) return;
    const to = v.getUint16(1);
    const payload = data.slice(3);
    const me = s.room.mid;
    const targets = to === BROADCAST ? Object.entries(s.conns).filter(([mid]) => Number(mid) !== me).map(([, c]) => c) : [s.conns[to]].filter(Boolean);
    // Each delivery is a Durable Object request: over budget, frames are dropped
    // (the engine's own reliability resends what matters) and counted.
    if (!this.relayBudget.take(targets.length)) {
      this.relayDropped += targets.length;
      const now = Date.now();
      if (now - this.relayReportedAt >= RELAY_REPORT_MS) {
        usage(this.env, s.project).hit(s.project, "relay", this.relayDropped).catch(() => {});
        this.relayDropped = 0;
        this.relayReportedAt = now;
      }
      return;
    }
    for (const conn of targets) this.peer(conn).relay(me, payload, kind).catch(() => {});
  }

  // ── RPC from rooms and other sessions ──

  async deliver(ev: Record<string, unknown>): Promise<void> {
    const s = this.load();
    if (!s) return;
    if (ev.t === "member_joined" && typeof ev._conn === "string") {
      s.conns[(ev.member as { mid: number }).mid] = ev._conn;
      delete ev._conn;
      this.save(s);
    } else if (ev.t === "member_left") {
      delete s.conns[Number(ev.mid)];
      this.save(s);
    } else if (ev.t === "room_closed") {
      s.room = undefined;
      s.conns = {};
      this.save(s);
      this.reserveSoon();
    }
    const ws = this.socket();
    const frame = JSON.stringify(ev);
    if (ws && s.disconnectedAt === undefined) return ws.send(frame);
    const buf = (this.ctx.storage.kv.get("buf") as string[] | undefined) ?? [];
    buf.push(frame);
    if (buf.length > BUFFER_LIMIT) buf.splice(0, buf.length - BUFFER_LIMIT);
    this.ctx.storage.kv.put("buf", buf);
  }

  async relay(from: number, payload: ArrayBuffer, kind = RELAY_FRAME): Promise<void> {
    const ws = this.socket();
    if (!ws) return;
    const out = new Uint8Array(payload.byteLength + 3);
    out[0] = kind;
    new DataView(out.buffer).setUint16(1, from);
    out.set(new Uint8Array(payload), 3);
    ws.send(out);
  }

  async kicked(): Promise<void> {
    await this.deliver({ t: "room_closed", reason: "kicked" });
  }

  private send(ws: WebSocket, v: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(v));
    } catch {
      /* socket already closed */
    }
  }
}
