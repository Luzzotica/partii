// Sign in on the phone, then join a real game's room: the game must learn
// who is playing and get their profile (name + look) in the phone's hello.
//   node test/signin-e2e.mjs --code KXQPT --key pk_... --edge URL --page URL --game tankii
// The page shows the result; the game's own log/test checks the other side.
import { chromium, devices } from "playwright";
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const [code, key, edge, page, game] = [arg("--code"), arg("--key"), arg("--edge"), arg("--page", "http://127.0.0.1:5180"), arg("--game", "tankii")];
const q = `k=${encodeURIComponent(key)}&e=${encodeURIComponent(edge)}`;
const browser = await chromium.launch();
const phone = await (await browser.newContext({ ...devices["iPhone 13 landscape"] })).newPage();
const out = { ok: false };
try {
  // 1. Sign in (dev/staging hand the code back; the page fills it in).
  await phone.goto(`${page}/signin?back=${encodeURIComponent(`/c/${code}?${q}`)}`);
  await phone.fill('input[type="email"]', `phone-${Date.now()}@example.com`);
  await phone.getByRole("button", { name: "Send code" }).click();
  await phone.locator('input[aria-label="Code"]').waitFor();
  await phone.waitForFunction(() => document.querySelector('input[aria-label="Code"]')?.value?.length === 6, null, { timeout: 10000 });
  await phone.getByRole("button", { name: "Sign in" }).click();
  await phone.waitForURL(new RegExp(`/c/${code}`), { timeout: 10000 });
  const player = await phone.evaluate(() => JSON.parse(localStorage.getItem("partii.player")));
  out.player = player.id;
  // 2. The player's saved profile for this game (normally written by the game).
  const put = await fetch(`${edge}/v1/saves/${game}/profile`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-partii-key": key, authorization: `Bearer ${player.token}` },
    body: JSON.stringify({ base_rev: 0, data: { name: "Ana", skin_id: "camo", hat_id: "cap", tread_id: null } }),
  }).then((r) => r.json());
  out.profile_saved = put.ok;
  // 3. Rejoin so the hello carries it.
  await phone.goto(`${page}/c/${code}?${q}`);
  await phone.waitForFunction(() => /·/.test(document.querySelector("[data-testid=status]")?.textContent ?? "") && !/Joining/.test(document.querySelector("[data-testid=status]").textContent), null, { timeout: 20000 });
  out.status = await phone.textContent("[data-testid=status]");
  out.signin_link_hidden = (await phone.locator("[data-testid=signin-link]").count()) === 0;
  await phone.waitForTimeout(1500);
  out.ok = put.ok && out.signin_link_hidden;
} catch (e) {
  out.error = String(e).slice(0, 300);
}
console.log(JSON.stringify(out));
await browser.close();
process.exit(out.ok ? 0 : 1);
