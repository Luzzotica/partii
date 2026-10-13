// The game's theme is on the phone from the first render: a developer themes
// a game, the game hosts a room, a phone opens the QR link (with g=) and must
// never show partii's own look; a phone that typed the code gets the theme
// once it has joined.
//   PARTII_API=http://127.0.0.1:8787 node test/theme-e2e.mjs [--shot out.png]   (local edge, after npm run build)
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const edge = process.env.PARTII_API ?? "http://127.0.0.1:8787";
const admin = process.env.PARTII_ADMIN_TOKEN ?? "dev-admin-token";
const a = process.argv.slice(2);

async function api(method, path, { token, body, bytes, key } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["x-partii-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(edge + path, { method, headers, body: bytes ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method} ${path}: ${JSON.stringify(j.error)}`);
  return j;
}

// A themed game (Tankii's colours).
const id = Date.now().toString(36);
const dev = (await api("POST", "/v1/admin/developers", { token: admin, body: { email: `theme-e2e-${id}@example.com`, name: "Theme e2e" } })).token;
const project = `themee2e${id}`;
await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Theme e2e" } });
const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).key.key;
const gameId = `themed-${id}`;
await api("PUT", `/v1/games/${gameId}`, { token: dev, body: { project, title: "Themed", price_cents: 0, platforms: ["web"] } });
// A 1×1 PNG logo.
const logo = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
await api("PUT", `/v1/games/${gameId}/theme/uploads/logo.png`, { token: dev, bytes: logo });
await api("PUT", `/v1/games/${gameId}/theme`, {
  token: dev,
  body: {
    name: "Themed",
    colors: { background: "#EFE6D4", surface: "#E3D6BD", border: "#8B6F47", ink: "#3A2F1F", primary: "#4F8EF7", primary_lip: "#2F64C4", primary_ink: "#FFFFFF", secondary: "#E3D6BD", secondary_lip: "#C9B894", stick_ring: "#8B6F47" },
    fonts: { heading: "Trebuchet MS, sans-serif", body: "Trebuchet MS, sans-serif" },
    radius: 12,
    border: 3,
    lip: 4,
    caps: true,
    letter_spacing: 0.08,
    logo: "logo.png",
  },
});

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
const results = {};
const done = async (ok, extra = {}) => {
  console.log(JSON.stringify({ ok, ...results, ...extra }));
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
};

// The game hosts a room for the themed game.
const game = await browser.newPage();
await game.goto(`${base}/`);
const code = await game.evaluate(
  async ({ edge, key, gameId }) => {
    const mod = await import("/engine/partii_engine.js");
    await mod.default();
    const e = new mod.WebEngine(JSON.stringify({ edge, key, conn: "", client: "e2e-game", player_token: null, no_webrtc: false }));
    window.__e = e;
    return await new Promise((resolve) => {
      let asked = false;
      setInterval(() => {
        for (const ev of JSON.parse(e.poll())) {
          if (ev.ev === "online" && !asked) {
            asked = true;
            e.create(gameId, 8, "game", "Game", "null");
          }
          if (ev.ev === "created") resolve(ev.room.code);
        }
      }, 10);
    });
  },
  { edge, key, gameId },
);

const BG = "rgb(239, 230, 212)";
const rgb = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** A phone; records the body colour at the first render (when #root gets children). */
async function phone(url) {
  const ctx = await browser.newContext({ ...devices["iPhone 13 landscape"] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.setItem("partii.name", "Sam");
    new MutationObserver((_, obs) => {
      const root = document.getElementById("root");
      if (root?.firstChild) {
        window.__firstBg = getComputedStyle(document.body).backgroundColor;
        window.__firstFire = getComputedStyle(document.querySelector("[data-testid=fire]") ?? root.firstChild).backgroundColor;
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await p.goto(url);
  await p.waitForFunction(() => /·/.test(document.querySelector("[data-testid=status]")?.textContent ?? ""), null, { timeout: 15000 });
  return p;
}

try {
  // From the QR link: themed at the first render, and again from this phone's cache.
  const link = `${base}/c/${code}?k=${encodeURIComponent(key)}&e=${encodeURIComponent(edge)}&g=${gameId}`;
  const p1 = await phone(link);
  results.qr_first_render_bg = await p1.evaluate(() => window.__firstBg);
  results.qr_fire = await p1.evaluate(() => window.__firstFire);
  results.logo = await p1.evaluate(() => !!document.querySelector("header img.logo")?.getAttribute("src"));
  results.caps = await p1.evaluate(() => getComputedStyle(document.querySelector("[data-testid=fire]")).textTransform);
  results.lip = await p1.evaluate(() => getComputedStyle(document.querySelector("[data-testid=fire]")).boxShadow);
  if (a.includes("--shot")) await p1.screenshot({ path: a[a.indexOf("--shot") + 1] });
  if (results.qr_first_render_bg !== BG) await done(false, { error: "QR link: first render wasn't themed" });
  if (results.qr_fire !== "rgb(79, 142, 247)") await done(false, { error: "QR link: FIRE isn't the theme's primary" });
  if (!results.logo || results.caps !== "uppercase" || !results.lip.includes("47, 100, 196")) await done(false, { error: "logo, caps or lip missing" });
  await p1.reload();
  await p1.waitForFunction(() => /·/.test(document.querySelector("[data-testid=status]")?.textContent ?? ""), null, { timeout: 15000 });
  results.cached_first_render_bg = await p1.evaluate(() => window.__firstBg);
  if (results.cached_first_render_bg !== BG) await done(false, { error: "cached: first render wasn't themed" });

  // A typed code (no g=): partii's look until joined, then the game's.
  const p2 = await phone(`${base}/c/${code}?k=${encodeURIComponent(key)}&e=${encodeURIComponent(edge)}`);
  await p2.waitForFunction((bg) => getComputedStyle(document.body).backgroundColor === bg, BG, { timeout: 5000 });
  results.typed_code_themed_after_join = true;
  await done(true);
} catch (e) {
  await done(false, { error: String(e).split("\n")[0] });
}
