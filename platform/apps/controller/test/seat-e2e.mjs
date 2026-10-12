// A phone joins a real game's room and must be given a seat: open the
// controller for a room code, tap START, wait for the game's {"t":"seat"}.
//   node test/seat-e2e.mjs --code KXQPT --key pk_... --edge URL [--page URL] [--shot out.png]
import { chromium, devices } from "playwright";
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const page = arg("--page", "https://partii-controller-staging.vercel.app");
const url = `${page}/c/${arg("--code")}?k=${encodeURIComponent(arg("--key"))}&e=${encodeURIComponent(arg("--edge"))}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13 landscape"] });
const phone = await ctx.newPage();
await phone.addInitScript(() => localStorage.setItem("partii.name", "Phone"));
const t0 = Date.now();
await phone.goto(url);
const status = () => phone.textContent("[data-testid=status]").catch(() => "");
let out = { ok: false };
try {
  await phone.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.includes("·") && !document.querySelector("[data-testid=status]")?.textContent?.startsWith("Joining"), null, { timeout: 20000 });
  const joined = Date.now() - t0;
  // Hold START a moment, as a player would to drop in.
  const s = await phone.locator("[data-testid=start]").boundingBox();
  await phone.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await phone.mouse.down();
  await phone.waitForTimeout(400);
  await phone.mouse.up();
  await phone.waitForFunction(() => /^P\d/.test(document.querySelector("[data-testid=status]")?.textContent ?? ""), null, { timeout: 15000 });
  out = { ok: true, join_ms: joined, status: await status() };
} catch (e) {
  out = { ok: false, error: String(e).split("\n")[0], status: await status() };
}
if (a.includes("--shot")) await phone.screenshot({ path: arg("--shot") });
console.log(JSON.stringify(out));
await browser.close();
process.exit(out.ok ? 0 : 1);
