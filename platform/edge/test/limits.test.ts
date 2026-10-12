import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { allowed, Bucket, LIMIT_WINDOW_MS, LIMITS, limitsFor } from "../src/limits";
import { type Alert, sendAlert, STALE_MS, usage } from "../src/usage";
import { Client, connected, newConn, sleep } from "./client";

const E = env as any;
let n = 0;
const project = () => `usage${Date.now().toString(36)}${n++}`;

/** Poll until `pred` holds (usage reports are fire and forget). */
async function until<T>(f: () => Promise<T>, pred: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (pred(v) || Date.now() > end) return v;
    await sleep(25);
  }
}

describe("rate limits", () => {
  it("are off unless RATE_LIMITS is set, and take overrides", async () => {
    expect(limitsFor({})).toBeNull();
    expect(limitsFor({ RATE_LIMITS: "off" })).toBeNull();
    expect(limitsFor({ RATE_LIMITS: "on" })).toEqual(LIMITS);
    expect(limitsFor({ RATE_LIMITS: '{"session":3}' })).toEqual({ ...LIMITS, session: 3 });
    expect(await allowed({ RATE_LIMITS: "on" }, "create", "1.2.3.4")).toBe(true); // no LIMITER bound
  });

  it("count each kind per IP in one-minute windows", async () => {
    const l = E.LIMITER.get(E.LIMITER.idFromName("203.0.113.1"));
    const t = 1_000_000;
    expect([await l.take("create", 2, t), await l.take("create", 2, t + 1), await l.take("create", 2, t + 2)]).toEqual([true, true, false]);
    expect(await l.take("join", 2, t + 3)).toBe(true);
    expect(await l.take("create", 2, t + LIMIT_WINDOW_MS)).toBe(true);
  });

  it("new sessions per IP: over the limit the socket gets rate_limited and is closed", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 3; i++) expect((await new Client(newConn(), ip).open().then((c) => c.hello())).t).toBe("welcome");
    const c = await new Client(newConn(), ip).open();
    expect(await c.hello()).toMatchObject({ t: "err", code: "rate_limited" });
    await until(async () => c.closed, (v) => v);
    expect(c.closed).toBe(true);
    // Another network is unaffected.
    expect((await new Client().open().then((x) => x.hello())).t).toBe("welcome");
  });

  it("a resumed session is not a new session", async () => {
    const ip = "198.51.100.8";
    const conn = newConn();
    for (let i = 0; i < 5; i++) {
      const c = await new Client(conn, ip).open();
      expect((await c.hello()).t).toBe("welcome");
      c.close();
    }
  });

  it("room creates per IP", async () => {
    const c = await connected();
    for (let i = 0; i < 3; i++) {
      expect((await c.req({ t: "create", game: "x" })).t).toBe("ok");
      await c.req({ t: "leave" });
    }
    expect(await c.req({ t: "create", game: "x" })).toMatchObject({ t: "err", code: "rate_limited" });
  });

  it("joins per IP", async () => {
    const c = await connected();
    for (let i = 0; i < 10; i++) expect(await c.req({ t: "join", code: "ZZZZ" })).toMatchObject({ code: "not_found" });
    expect(await c.req({ t: "join", code: "ZZZZ" })).toMatchObject({ code: "rate_limited" });
  });

  it("websocket upgrades per IP are refused with 429 before any session", async () => {
    const ip = "198.51.100.9";
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await SELF.fetch(`https://edge/v1/connect?conn=${newConn()}`, { headers: { upgrade: "websocket", "cf-connecting-ip": ip } });
      codes.push(r.status);
      r.webSocket?.accept();
      r.webSocket?.close();
    }
    expect(codes.slice(0, 6).every((c) => c === 101)).toBe(true);
    expect(codes[6]).toBe(429);
  });

  it("the relay budget refills at its rate up to its burst", () => {
    const b = new Bucket(10, 20, 0);
    expect(b.take(20, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.take(5, 500)).toBe(true);
    expect(b.take(1, 500)).toBe(false);
    expect(b.take(20, 100_000)).toBe(true);
  });
});

describe("usage", () => {
  it("counts live sessions and rooms, and alerts at the threshold (once, again when it doubles)", async () => {
    const p = project();
    const u = usage(E, p);
    for (let i = 0; i < 2; i++) await u.up(p, "session", `s${i}`);
    expect((await u.view()).alerts).toEqual([]);
    await u.up(p, "session", "s2");
    await u.up(p, "session", "s3");
    let v = await u.view();
    expect(v).toMatchObject({ sessions: 4, peak: { sessions: 4 } });
    expect(v.alerts).toEqual([expect.objectContaining({ metric: "sessions", value: 3, threshold: 3 })]);
    for (let i = 4; i < 6; i++) await u.up(p, "session", `s${i}`);
    v = await u.view();
    expect(v.alerts.map((a) => a.value)).toEqual([3, 6]);
    await u.down("session", "s0");
    await u.up(p, "session", "s1"); // refresh, not a new start
    v = await u.view();
    expect(v.sessions).toBe(5);
    expect(v.peak.sessions).toBe(6);
    expect(v.hours[0].counts.sessions_started).toBe(6);
  });

  it("drops rows whose end report was lost", async () => {
    const p = project();
    const u = usage(E, p);
    const now = Date.now();
    await u.up(p, "session", "old", now - STALE_MS.session - 120_000);
    await u.up(p, "session", "new", now);
    expect((await u.view()).sessions).toBe(1);
  });

  it("counts limit hits and relay drops per hour, with alerts", async () => {
    const p = project();
    const u = usage(E, p);
    await u.hit(p, "create");
    await u.hit(p, "join");
    await u.hit(p, "relay", 150);
    const v = await u.view();
    expect(v.hours[0].counts).toMatchObject({ limited_create: 1, limited_join: 1, relay_dropped: 150 });
    expect(v.alerts.map((a) => a.metric).sort()).toEqual(["limited", "relay_dropped"]);
  });

  it("sessions and rooms report themselves from the live protocol", async () => {
    const host = await connected();
    expect((await host.req({ t: "create", game: "g" })).t).toBe("ok");
    const has = (v: Awaited<ReturnType<ReturnType<typeof usage>["view"]>>) => v.sessions > 0 && v.rooms > 0;
    const v = await until(() => usage(E, "demo").view(), has);
    expect(has(v)).toBe(true);
    const before = v.rooms;
    await host.req({ t: "leave" });
    const after = await until(() => usage(E, "demo").view(), (x) => x.rooms < before);
    expect(after.rooms).toBe(before - 1);
  });

  it("posts alerts to the webhook (Slack `text`, Discord `content`) and survives a failing one", async () => {
    const a: Alert = { at: 1, project: "p", metric: "sessions", value: 160, threshold: 150 };
    const sent: any[] = [];
    await sendAlert({ PARTII_ENV: "test", ALERT_WEBHOOK_URL: "https://hooks.example/x" }, a, (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response("ok"))) as any);
    expect(sent[0].text).toContain("project p has 160 live sessions (alert at 150)");
    expect(sent[0].content).toBe(sent[0].text);
    await sendAlert({ PARTII_ENV: "test", ALERT_WEBHOOK_URL: "https://hooks.example/x" }, a, (async () => { throw new Error("down"); }) as any);
    await sendAlert({ PARTII_ENV: "test" }, a, (async () => { throw new Error("must not be called"); }) as any);
  });

  it("is readable by operators only", async () => {
    expect((await SELF.fetch("https://edge/v1/admin/usage")).status).toBe(401);
    const r = await SELF.fetch("https://edge/v1/admin/usage?project=demo", { headers: { authorization: "Bearer dev-admin-token" } });
    const body = (await r.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.projects[0]).toMatchObject({ project: "demo", thresholds: { sessions: 3 } });
  });
});
