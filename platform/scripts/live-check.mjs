// Live checks of the room protocol against a running edge (no build needed):
//   EDGE=https://api-staging.partii.games KEY=pk_... GAME=mygame node scripts/live-check.mjs [kinds|reclaim]
// kinds:   per-kind rules (a closed kind is refused, a capped kind fills) and member_update.
// reclaim: the host's socket drops without leaving; after the 20 s grace the edge
//          times it out (guests get room_closed host_lost), a new session reclaims the
//          same code with the token, and the phone rejoins it. Takes about 25 s.
// Prints one JSON line; exits 1 if a check fails.
const edge = (process.env.EDGE ?? "").replace(/^http/, "ws").replace(/\/$/, "");
const key = process.env.KEY ?? "";
const game = process.env.GAME ?? "live-check";
const mode = process.argv[2] ?? "kinds";
if (!edge || !key) throw new Error("set EDGE and KEY");

const conn = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
async function client() {
  const ws = new WebSocket(`${edge}/v1/connect?conn=${conn()}`);
  const q = [];
  let wake = null;
  let id = 0;
  ws.onmessage = (e) => {
    if (typeof e.data === "string" && e.data !== "pong") {
      q.push(JSON.parse(e.data));
      wake?.();
    }
  };
  await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
  const next = async (pred, ms = 40_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const k = q.findIndex(pred);
      if (k >= 0) return q.splice(k, 1)[0];
      await new Promise((ok) => ((wake = ok), setTimeout(ok, 100)));
    }
    throw new Error("timed out waiting");
  };
  const req = async (m) => {
    const n = ++id;
    ws.send(JSON.stringify({ ...m, id: n }));
    return next((f) => f.id === n);
  };
  ws.send(JSON.stringify({ t: "hello", key, v: 1, client: "live-check" }));
  await next((f) => f.t === "welcome");
  return { req, next, close: () => ws.close() };
}

let checks;
if (mode === "reclaim") {
  const host = await client();
  const phone = await client();
  const made = await host.req({ t: "create", game, kinds: { game: { joinable: false } } });
  const { code, reclaim } = made.room;
  await phone.req({ t: "join", code, kind: "phone" });
  host.close(); // dropped, not left
  const closed = await phone.next((f) => f.t === "room_closed");
  const back = await client();
  const r = await back.req({ t: "create", game, kinds: { game: { joinable: false } }, reclaim: { code, token: reclaim } });
  const rejoin = await phone.req({ t: "join", code, kind: "phone" });
  checks = { host_lost: closed.reason === "host_lost", reclaimed: r.reclaimed === true, same_code: r.room?.code === code, kinds_kept: r.room?.kinds?.game?.joinable === false, phone_rejoined: rejoin.t === "ok" };
  await back.req({ t: "leave" });
  back.close();
  phone.close();
} else {
  const host = await client();
  const g = await client();
  const phone = await client();
  const made = await host.req({ t: "create", game, kinds: { game: { joinable: false }, phone: { max: 1 } } });
  const code = made.room.code;
  const refused = await g.req({ t: "join", code, kind: "game" });
  const joined = await phone.req({ t: "join", code, kind: "phone" });
  const opened = await host.req({ t: "update", kinds: { game: { joinable: true } } });
  const gJoined = await g.req({ t: "join", code, kind: "game" });
  const renamed = await phone.req({ t: "member_update", name: "Sam" });
  const heard = await host.next((f) => f.t === "member_updated");
  checks = { game_refused: refused.code === "not_joinable", phone_joined: joined.t === "ok", opened: opened.room?.kinds?.game?.joinable === true, game_joined: gJoined.t === "ok", renamed: renamed.member?.name === "Sam", host_heard: heard.member?.name === "Sam" };
  await host.req({ t: "leave" });
  for (const c of [host, g, phone]) c.close();
}
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ ok, mode, checks }));
process.exit(ok ? 0 : 1);
