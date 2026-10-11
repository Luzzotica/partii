// A shopper's trip through the store (after `npm run build` with VITE_PARTII_API
// and VITE_PARTII_KEY): find the game, buy it, see it in the library, sign in.
//   GAME=tankii-xyz SHOTS=/tmp/store node test/e2e.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const game = process.env.GAME;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  let p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(p) || p.endsWith("/")) p = join(dist, "index.html");
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const steps = {};
const shot = async (n) => shots && (await page.screenshot({ path: `${shots}/${n}.png` }));
try {
  await page.goto(base);
  await page.waitForSelector(`[data-testid=game-${game}]`, { timeout: 10000 });
  steps.listed = true;
  await shot("1-front");
  await page.click(`[data-testid=game-${game}]`);
  await page.waitForSelector("[data-testid=buy]");
  steps.page = (await page.textContent("[data-testid=buy]")).includes("4.99");
  steps.demo_note = (await page.textContent("body")).includes("first 20 levels are free");
  await shot("2-game");
  await page.click("[data-testid=buy]");
  await page.waitForSelector("[data-testid=owned]", { timeout: 10000 });
  steps.bought = true;
  await shot("3-bought");
  await page.click("text=Library");
  await page.waitForSelector("[data-testid=library]");
  steps.library = (await page.textContent("[data-testid=library]")).length > 0;
  await shot("4-library");
  await page.click("text=Sign in");
  await page.fill("[data-testid=email]", `shopper${Date.now()}@example.com`);
  await page.click("[data-testid=signin]");
  const note = await page.textContent("[data-testid=signin-note]");
  const code = /\b(\d{6})\b/.exec(note)?.[1];
  await page.fill("[data-testid=code]", code);
  await page.click("[data-testid=signin]");
  await page.waitForFunction(() => document.querySelector("[data-testid=signin-note]")?.textContent?.startsWith("Signed in"));
  steps.signed_in = true;
  await shot("5-signed-in");
  // The game is still there after signing in (the guest became the account).
  await page.click("text=Library");
  await page.waitForSelector("[data-testid=library]");
  steps.kept_after_signin = true;
} catch (e) {
  steps.error = String(e).split("\n")[0];
}
const ok = !steps.error && ["listed", "page", "demo_note", "bought", "library", "signed_in", "kept_after_signin"].every((k) => steps[k]);
console.log(JSON.stringify({ ok, steps }));
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
