// End to end: a "game" page hosts a room with the engine; an emulated phone
// opens the controller from the room's link, moves the stick and fires; the
// game must receive the hello and matching input frames.
//   PARTII_API=http://127.0.0.1:8787 PARTII_KEY=pk_... npm test   (after npm run build)
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const edge = process.env.PARTII_API ?? "http://127.0.0.1:8787";
const key = process.env.PARTII_KEY;
if (!key) throw new Error("set PARTII_KEY");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(p) || p.endsWith("/")) p = join(dist, "index.html");
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const fail = async (msg) => {
  console.log(JSON.stringify({ ok: false, error: msg }));
  await browser.close();
  server.close();
  process.exit(1);
};

// The game.
const game = await browser.newPage();
await game.goto(`${base}/`);
const code = await game.evaluate(async ({ edge, key }) => {
  const mod = await import("/engine/partii_engine.js");
  await mod.default();
  const e = new mod.WebEngine(JSON.stringify({ edge, key, conn: "", client: "e2e-game", player_token: null, no_webrtc: false }));
  window.__game = { e, frames: [], hello: null, members: [] };
  return await new Promise((resolve) => {
    let asked = false;
    setInterval(() => {
      for (const ev of JSON.parse(e.poll())) {
        if (ev.ev === "online" && !asked) { asked = true; e.create("e2e", 4, "game", "Game", "null"); }
        if (ev.ev === "created") resolve(ev.room.code);
        if (ev.ev === "member_joined") window.__game.members.push(ev.member);
        if (ev.ev === "message") {
          const b = new Uint8Array(ev.bytes);
          if (b[0] === 0x50) {
            const v = new DataView(b.buffer);
            window.__game.frames.push({ lx: v.getInt8(3), ly: v.getInt8(4), buttons: v.getUint16(7, true) });
          } else {
            try { const m = JSON.parse(new TextDecoder().decode(b)); if (m.t === "hello") window.__game.hello = m; } catch {}
          }
        }
      }
    }, 10);
  });
}, { edge, key });

// The phone.
const phoneCtx = await browser.newContext({ ...devices["iPhone 13 landscape"] });
const phone = await phoneCtx.newPage();
await phone.addInitScript(() => localStorage.setItem("partii.name", "Sam"));
const t0 = Date.now();
await phone.goto(`${base}/c/${code}?k=${encodeURIComponent(key)}&e=${encodeURIComponent(edge)}`);
try {
  await phone.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.includes("Connected"), null, { timeout: 15000 });
} catch {
  await fail(`phone never connected: ${await phone.textContent("body")}`);
}
const joinMs = Date.now() - t0;
await phone.screenshot({ path: "/tmp/controller-phone.png" });

// Push the move stick right, then hold fire.
const stick = await phone.locator("[data-testid=move]").boundingBox();
const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
await phone.mouse.move(cx, cy);
await phone.mouse.down();
await phone.mouse.move(cx + stick.width * 0.45, cy, { steps: 4 });
await phone.waitForTimeout(400);
await phone.mouse.up();
const fire = await phone.locator("[data-testid=fire]").boundingBox();
await phone.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
await phone.mouse.down();
await phone.waitForTimeout(300);
await phone.mouse.up();
await phone.waitForTimeout(300);

const g = await game.evaluate(() => ({ frames: window.__game.frames, hello: window.__game.hello, members: window.__game.members }));
const moved = g.frames.some((f) => f.lx > 80);
const fired = g.frames.some((f) => (f.buttons & 1) === 1);
const released = g.frames.length > 0 && g.frames[g.frames.length - 1].buttons === 0;
const checks = {
  phone_member: g.members.some((m) => m.kind === "phone" && m.name === "Sam"),
  hello: g.hello?.name === "Sam",
  frames: g.frames.length > 10,
  moved,
  fired,
  released,
};
console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), join_ms: joinMs, frames: g.frames.length, checks }));
await browser.close();
server.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
