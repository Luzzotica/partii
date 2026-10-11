import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, connected, key, roomWithGuest, sleep } from "./client";

describe("hello", () => {
  it("must come first", async () => {
    const c = await new Client().open();
    expect(await c.req({ t: "create", game: "x" })).toMatchObject({ t: "err", code: "unauthorized" });
  });

  it("rejects a bad or tampered key", async () => {
    const c = await new Client().open();
    expect(await c.hello("pk_demo_k1_AAAAAAAAAAAAAAAAAAAAAA")).toMatchObject({ t: "err", code: "unauthorized" });
    const good = await key();
    const c2 = await new Client().open();
    expect(await c2.hello(good.replace("demo", "other"))).toMatchObject({ t: "err", code: "unauthorized" });
  });

  it("welcomes with relay info and never a STUN-only list", async () => {
    const c = await new Client().open();
    const w = await c.hello();
    expect(w).toMatchObject({ t: "welcome", project: "demo", resumed: false, relay: "ws", ice_servers: [] });
    expect(w.conn).toBe(c.conn);
  });

  it("answers ping", async () => {
    const c = await connected();
    const r = await c.req({ t: "ping" });
    expect(r.t).toBe("ok");
    expect(Math.abs(r.server_time - Date.now())).toBeLessThan(5000);
  });

  it("rejects unknown messages and non-JSON", async () => {
    const c = await connected();
    expect(await c.req({ t: "nope" })).toMatchObject({ t: "err", code: "bad_request" });
    c.ws.send("not json");
    expect(await c.event("err")).toMatchObject({ code: "bad_request" });
  });
});

describe("rooms", () => {
  it("create gives a code and makes you host", async () => {
    const c = await connected();
    const r = await c.req({ t: "create", game: "tankii", name: "Sterling", max_members: 4, meta: { mode: "coop" } });
    expect(r.t).toBe("ok");
    expect(r.room.code).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(r.room).toMatchObject({ game: "tankii", host: 1, you: 1, max_members: 4, joinable: true, meta: { mode: "coop" } });
    expect(r.room.members).toEqual([{ mid: 1, kind: "game", name: "Sterling", meta: { mode: "coop" }, status: "active" }]);
  });

  it("create needs a game and you can only be in one room", async () => {
    const c = await connected();
    expect(await c.req({ t: "create" })).toMatchObject({ t: "err", code: "bad_request" });
    await c.req({ t: "create", game: "g" });
    expect(await c.req({ t: "create", game: "g" })).toMatchObject({ t: "err", code: "already_in_room" });
  });

  it("join by code (any case) tells the host", async () => {
    const { host, joined } = await roomWithGuest();
    expect(joined.room).toMatchObject({ you: 2, host: 1 });
    expect(joined.room.members.map((m: any) => m.name)).toEqual(["H", "G"]);
    expect(host.frames.length).toBe(0);
    const host2 = await connected();
    const made = await host2.req({ t: "create", game: "g" });
    const g = await connected();
    const r = await g.req({ t: "join", code: made.room.code.toLowerCase(), kind: "phone", name: "Phone" });
    expect(r.room.you).toBe(2);
    expect(await host2.event("member_joined")).toMatchObject({ member: { mid: 2, kind: "phone", name: "Phone", status: "active" } });
    expect((await host2.frames.length)).toBe(0);
  });

  it("join errors: unknown, malformed, full, closed to new players", async () => {
    const g = await connected();
    expect(await g.req({ t: "join", code: "QQQQQ" })).toMatchObject({ t: "err", code: "not_found" });
    expect(await g.req({ t: "join", code: "12" })).toMatchObject({ t: "err", code: "bad_request" });
    const { host, code } = await roomWithGuest({ max_members: 2 });
    expect(await g.req({ t: "join", code })).toMatchObject({ t: "err", code: "full" });
    await host.req({ t: "update", max_members: 3, joinable: false });
    expect(await g.req({ t: "join", code })).toMatchObject({ t: "err", code: "not_joinable" });
  });

  it("rooms are private to their project", async () => {
    const { code } = await roomWithGuest();
    const other = await connected(await key("otherproj", "k9"));
    expect(await other.req({ t: "join", code })).toMatchObject({ t: "err", code: "not_found" });
  });

  it("only the host updates or kicks", async () => {
    const { host, guest } = await roomWithGuest();
    expect(await guest.req({ t: "update", joinable: false })).toMatchObject({ t: "err", code: "not_host" });
    expect(await guest.req({ t: "kick", mid: 1 })).toMatchObject({ t: "err", code: "not_host" });
    const r = await host.req({ t: "update", meta: { map: 3 } });
    expect(r.room.meta).toEqual({ map: 3 });
    expect(await guest.event("room_updated")).toMatchObject({ room: { meta: { map: 3 }, you: 2 } });
  });

  it("kick removes the member and tells everyone", async () => {
    const { host, guest } = await roomWithGuest();
    const third = await connected();
    await third.req({ t: "join", code: (await host.req({ t: "update" })).room.code });
    await host.event("member_joined");
    await guest.event("member_joined");
    expect(await host.req({ t: "kick", mid: 2 })).toMatchObject({ t: "ok" });
    expect(await guest.event("room_closed")).toMatchObject({ reason: "kicked" });
    expect(await third.event("member_left")).toMatchObject({ mid: 2, reason: "kicked" });
  });

  it("leaving tells the others; the host leaving closes the room", async () => {
    const { host, guest, code } = await roomWithGuest();
    await guest.req({ t: "leave" });
    expect(await host.event("member_left")).toMatchObject({ mid: 2, reason: "left" });
    const g2 = await connected();
    await g2.req({ t: "join", code });
    await host.event("member_joined");
    await host.req({ t: "leave" });
    expect(await g2.event("room_closed")).toMatchObject({ reason: "host_left" });
    const g3 = await connected();
    expect(await g3.req({ t: "join", code })).toMatchObject({ t: "err", code: "not_found" });
  });
});

describe("signals and relay", () => {
  it("signals go to one member, tagged with the sender", async () => {
    const { host, guest } = await roomWithGuest();
    host.send({ t: "signal", to: 2, data: { sdp: "offer" } });
    expect(await guest.event("signal")).toEqual({ t: "signal", from: 1, data: { sdp: "offer" } });
    guest.send({ t: "signal", to: 1, data: { sdp: "answer" } });
    expect(await host.event("signal")).toEqual({ t: "signal", from: 2, data: { sdp: "answer" } });
    expect(await guest.req({ t: "signal", to: 9, data: 1 })).toMatchObject({ t: "err", code: "not_found" });
  });

  it("relays binary packets to one member or everyone", async () => {
    const { host, guest, code } = await roomWithGuest();
    guest.relay(1, [7, 8, 9]);
    expect(await host.binary()).toEqual({ from: 2, bytes: [7, 8, 9] });
    const third = await connected();
    await third.req({ t: "join", code });
    await host.event("member_joined");
    await guest.event("member_joined");
    host.relay(0xffff, [1, 2]);
    expect(await guest.binary()).toEqual({ from: 1, bytes: [1, 2] });
    expect(await third.binary()).toEqual({ from: 1, bytes: [1, 2] });
  });

  it("keeps relayed order under a burst", async () => {
    const { host, guest } = await roomWithGuest();
    for (let i = 0; i < 50; i++) guest.relay(1, [i]);
    const got: number[] = [];
    for (let i = 0; i < 50; i++) got.push((await host.binary()).bytes[0]);
    expect(got).toEqual([...Array(50).keys()]);
  });
});

describe("dropped sockets", () => {
  it("holds the seat, buffers events and resumes", async () => {
    const { host, guest } = await roomWithGuest();
    guest.close();
    expect(await host.event("member_suspended")).toMatchObject({ mid: 2 });
    host.send({ t: "signal", to: 2, data: "while-away" });
    await sleep(50);
    const back = await new Client(guest.conn).open();
    const w = await back.hello();
    expect(w).toMatchObject({ t: "welcome", resumed: true, room: { you: 2, host: 1 } });
    expect(await back.event("signal")).toMatchObject({ from: 1, data: "while-away" });
    expect(await host.event("member_resumed")).toMatchObject({ mid: 2 });
    back.relay(1, [42]);
    expect(await host.binary()).toEqual({ from: 2, bytes: [42] });
  });

  it("a newer socket for the same session replaces the old one", async () => {
    const { host, guest } = await roomWithGuest();
    const again = await new Client(guest.conn).open();
    expect(await again.hello()).toMatchObject({ resumed: true, room: { you: 2 } });
    await sleep(50);
    expect(guest.closed).toBe(true);
    again.relay(1, [5]);
    expect(await host.binary()).toEqual({ from: 2, bytes: [5] });
    expect(host.frames.filter((f: any) => f.t === "member_suspended")).toEqual([]);
  });

  it("gives the seat up after the grace window", async () => {
    const { host, guest } = await roomWithGuest();
    guest.close();
    await host.event("member_suspended");
    const grace = Number((env as any).GRACE_MS);
    await sleep(grace + 50);
    const stub = (env as any).SESSION.get((env as any).SESSION.idFromName(guest.conn));
    await runDurableObjectAlarm(stub);
    expect(await host.event("member_left")).toMatchObject({ mid: 2, reason: "timeout" });
    const back = await new Client(guest.conn).open();
    expect(await back.hello()).toMatchObject({ resumed: false });
  });
});
