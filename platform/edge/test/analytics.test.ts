import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { fingerprint, normalizeMessage, topFrames } from "../src/api/analytics";

type Opts = { token?: string; key?: string; body?: unknown };

async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;
const DAY = 86_400_000;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `an${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "game", name: "game" } })).json.key.key as string;
  const game = `g-${project}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 0, platforms: ["macos"] } });
  return { dev, key, game };
}

const send = (s: { key: string; game: string }, device: string, events: unknown[], ctx: Record<string, unknown> = {}) =>
  api("POST", `/v1/games/${s.game}/events`, { key: s.key, body: { device, platform: "macos", version: "1.0.0", build: "steam", owned: true, ...ctx, events } });

describe("analytics", () => {
  it("records events and reports players, sessions, retention and funnels", async () => {
    const s = await setup();
    const t = Date.now();
    // Device A: first seen 2 days ago... but `at` older than 7 days is clamped, so stay inside the window.
    const a = `dev-a-${uniq()}`;
    const b = `dev-b-${uniq()}`;
    let r = await send(s, a, [
      { name: "session_start", at: t - DAY - 1000, session: "sa1" },
      { name: "level_complete", at: t - DAY, session: "sa1", props: { mission: 1, secs: 40 } },
      { name: "session_end", at: t - DAY + 1000, session: "sa1", props: { secs: 120 } },
      { name: "session_start", at: t - 2000, session: "sa2" },
      { name: "level_complete", at: t - 1000, session: "sa2", props: { mission: 2 } },
      { name: "Bad Name", at: t },
      { name: "nested", props: { x: { y: 1 } } },
      { name: "long", props: { s: "x".repeat(201) } },
    ]);
    expect(r.json).toMatchObject({ ok: true, accepted: 5, dropped: 3 });
    r = await send(s, b, [
      { name: "session_start", at: t - 5000, session: "sb1" },
      { name: "level_complete", at: t - 4000, session: "sb1", props: { mission: 1 } },
      { name: "session_end", at: t - 3000, session: "sb1", props: { secs: 60 } },
    ], { platform: "ios", version: "1.1.0", owned: false });
    expect(r.json.accepted).toBe(3);

    const sum = (await api("GET", `/v1/games/${s.game}/analytics?days=7`, { token: s.dev })).json;
    expect(sum.ok).toBe(true);
    expect(sum).toMatchObject({ players: 2, dau: 2, wau: 2, mau: 2, sessions: 3 });
    expect(sum.median_session_secs).toBe(60);
    const today = sum.days[sum.days.length - 1];
    expect(today).toMatchObject({ dau: 2, new: 1, returning: 1 });
    expect(sum.days[sum.days.length - 2]).toMatchObject({ dau: 1, new: 1, sessions: 1, median_session_secs: 120 });
    // A came back the day after it was first seen; B was first seen today (too late for D1).
    expect(sum.retention.d1).toEqual({ cohort: 1, returned: 1, rate: 1 });
    expect(sum.platforms.map((p: any) => p.k).sort()).toEqual(["ios", "macos"]);
    // Filters.
    const demo = (await api("GET", `/v1/games/${s.game}/analytics?days=7&owned=false`, { token: s.dev })).json;
    expect(demo).toMatchObject({ players: 1, dau: 1 });

    // Event names, per day, and the mission funnel.
    const names = (await api("GET", `/v1/games/${s.game}/events?days=7`, { token: s.dev })).json.names;
    expect(names.find((x: any) => x.name === "level_complete")).toEqual({ name: "level_complete", n: 3, devices: 2 });
    const perDay = (await api("GET", `/v1/games/${s.game}/events?days=7&name=level_complete`, { token: s.dev })).json;
    expect(perDay.total).toBe(3);
    expect(perDay.days.length).toBe(7);
    const funnel = (await api("GET", `/v1/games/${s.game}/events?days=7&name=level_complete&by=mission`, { token: s.dev })).json;
    expect(funnel.values).toEqual([
      { value: 1, n: 2, devices: 2 },
      { value: 2, n: 1, devices: 1 },
    ]);
    const byPlatform = (await api("GET", `/v1/games/${s.game}/events?days=7&name=level_complete&by=platform`, { token: s.dev })).json;
    expect(byPlatform.values[0]).toEqual({ value: "macos", n: 2, devices: 1 });
  });

  it("refuses the wrong key, bad batches, and strangers reading", async () => {
    const s = await setup();
    const other = await setup();
    expect((await api("POST", `/v1/games/${s.game}/events`, { key: other.key, body: { device: "dev-xxxxxxxx", events: [] } })).status).toBe(404);
    expect((await api("POST", `/v1/games/${s.game}/events`, { body: { device: "dev-xxxxxxxx", events: [] } })).status).toBe(401);
    expect((await send(s, "short", [{ name: "x" }])).status).toBe(400);
    expect((await send(s, "dev-xxxxxxxx", Array.from({ length: 101 }, () => ({ name: "x" })))).status).toBe(400);
    // `at` far in the past is replaced by now.
    await send(s, "dev-oldclock", [{ name: "x", at: 1000 }]);
    const sum = (await api("GET", `/v1/games/${s.game}/analytics?days=1`, { token: s.dev })).json;
    expect(sum.dau).toBe(1);
    expect((await api("GET", `/v1/games/${s.game}/analytics`, { token: other.dev })).status).toBe(404);
    expect((await api("GET", `/v1/games/${s.game}/analytics?days=9999`, { token: s.dev })).status).toBe(400);
    expect((await api("GET", `/v1/games/${s.game}/events?name=x&by=bad-prop`, { token: s.dev })).status).toBe(400);
  });

  it("groups error reports, keeps samples, and reopens fixed bugs", async () => {
    const s = await setup();
    const bt = (line: number) => `   0: std::backtrace::Backtrace::create::h0123456789abcdef
   1: std::panicking::begin_panic_handler
   2: tankii::game::world::step::hfedcba9876543210
             at ./src/game/world.rs:${line}:9
   3: tankii::game::update
   4: tankii::main
   5: main`;
    const err = (message: string, line = 12) => ({ kind: "panic", message, backtrace: bt(line), context: { screen: "level", mission: 3 }, session: "s1" });
    let r = await api("POST", `/v1/games/${s.game}/errors`, { key: s.key, body: { device: "dev-err-aaaa", version: "1.0.0", platform: "macos", errors: [err("index out of bounds: the len is 3 but the index is 5")] } });
    expect(r.json.ok).toBe(true);
    const fp = r.json.groups[0];
    // Same bug, other numbers, other device, other version: same group.
    r = await api("POST", `/v1/games/${s.game}/errors`, { key: s.key, body: { device: "dev-err-bbbb", version: "1.0.1", platform: "windows", errors: [err("index out of bounds: the len is 7 but the index is 9", 13), err("called `Option::unwrap()` on a `None` value")] } });
    expect(r.json.groups[0]).toBe(fp);
    expect(r.json.groups[1]).not.toBe(fp);
    let list = (await api("GET", `/v1/games/${s.game}/errors?sort=count`, { token: s.dev })).json.groups;
    expect(list.length).toBe(2);
    expect(list[0]).toMatchObject({ fingerprint: fp, kind: "panic", count: 2, devices: 2, versions: ["1.0.0", "1.0.1"], platforms: ["macos", "windows"], status: "open", top_frame: "tankii::game::world::step" });
    const one = (await api("GET", `/v1/games/${s.game}/errors/${fp}`, { token: s.dev })).json;
    expect(one.samples.length).toBe(2);
    expect(one.samples[0]).toMatchObject({ version: "1.0.1", context: { screen: "level", mission: 3 } });
    // Fixed, then seen again: open.
    expect((await api("POST", `/v1/games/${s.game}/errors/${fp}`, { token: s.dev, body: { status: "fixed" } })).json.status).toBe("fixed");
    expect((await api("GET", `/v1/games/${s.game}/errors`, { token: s.dev })).json.groups.length).toBe(1);
    await api("POST", `/v1/games/${s.game}/errors`, { key: s.key, body: { device: "dev-err-aaaa", version: "1.0.2", errors: [err("index out of bounds: the len is 1 but the index is 1")] } });
    list = (await api("GET", `/v1/games/${s.game}/errors?version=1.0.2`, { token: s.dev })).json.groups;
    expect(list).toMatchObject([{ fingerprint: fp, status: "open", count: 3, devices: 2 }]);
    // Only the latest samples are kept.
    for (let i = 0; i < 3; i++) await api("POST", `/v1/games/${s.game}/errors`, { key: s.key, body: { device: "dev-err-cccc", errors: Array.from({ length: 5 }, () => err("index out of bounds: the len is 2 but the index is 4")) } });
    expect((await api("GET", `/v1/games/${s.game}/errors/${fp}`, { token: s.dev })).json.samples.length).toBe(10);
    expect((await api("POST", `/v1/games/${s.game}/errors`, { key: s.key, body: { device: "dev-err-aaaa", errors: [{ kind: "oops", message: "x" }] } })).status).toBe(400);
  });

  it("fingerprints ignore what varies", async () => {
    expect(normalizeMessage('no file "a.json" at 0x7ff3 (code 12)')).toBe("no file S at X (code N)");
    expect(topFrames("   0: std::rt::lang_start\n   1: game::a::h0123456789abcdef\n   2: game::b\n   3: game::c\n   4: game::d")).toEqual(["game::a", "game::b", "game::c"]);
    // A panic hook's own frames (above the unwinding machinery) don't count.
    const hooked = "   0: partii_account::analytics::install_panic_hook::{{closure}}\n   1: std::panicking::rust_panic_with_hook\n   2: rust_begin_unwind\n   3: core::panicking::panic_fmt\n   4: core::panicking::panic_bounds_check\n   5: tankii::world::step\n   6: tankii::main";
    expect(topFrames(hooked)).toEqual(["tankii::world::step", "tankii::main"]);
    // A panic on a spawned thread: catch_unwind frames further down don't count as machinery.
    const spawned = "   3: partii_account::analytics::install_panic_hook::{closure#0}\n   5: std::panicking::panic_with_hook\n   7: std::sys::backtrace::__rust_end_short_backtrace\n   8: __rustc::rust_begin_unwind\n   9: core::panicking::panic_fmt\n  10: tankii::net::poll::{closure#0}\n  14: std::panicking::catch_unwind::do_call\n  21: std::sys::thread::unix::Thread::new::thread_start";
    expect(topFrames(spawned)).toEqual(["tankii::net::poll::{closure#0}"]);
    expect(await fingerprint("panic", "len 3", "")).toBe(await fingerprint("panic", "len 4", ""));
    expect(await fingerprint("panic", "len 3", "")).not.toBe(await fingerprint("error", "len 3", ""));
  });
});
