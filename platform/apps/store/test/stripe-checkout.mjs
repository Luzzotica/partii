// A real Stripe test-mode purchase on a deployed edge: a fresh guest player
// opens Checkout for a game, pays with Stripe's test card in headless
// Chromium, and the webhook (not the test shortcut) grants the entitlement.
//   PARTII_API=https://<staging edge> PARTII_KEY=pk_... GAME=tankii npm run test:stripe
import { chromium } from "playwright";

const edge = process.env.PARTII_API;
const key = process.env.PARTII_KEY;
const game = process.env.GAME ?? "tankii";
if (!edge || !key) throw new Error("set PARTII_API and PARTII_KEY (a staging edge with a Stripe test key)");

const api = async (method, path, body, token) => {
  const r = await fetch(edge + path, {
    method,
    headers: { "content-type": "application/json", "x-partii-key": key, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

const t0 = Date.now();
const guest = await api("POST", "/v1/players/guest", { device_id: `stripe-e2e-${crypto.randomUUID()}`, display_name: "Checkout Tester" });
if (!guest.ok) throw new Error(`guest: ${JSON.stringify(guest.error)}`);
const token = guest.player_token;
const before = await api("GET", `/v1/players/me/entitlements?game=${game}`, null, token);
const co = await api("POST", `/v1/store/games/${game}/checkout`, { success_url: "https://example.com/bought", cancel_url: "https://example.com/cancel" }, token);
if (!co.ok || !co.url?.startsWith("https://checkout.stripe.com/")) throw new Error(`checkout: ${JSON.stringify(co)}`);

const browser = await chromium.launch();
const page = await browser.newPage();
const done = async (result) => {
  console.log(JSON.stringify(result));
  await browser.close();
  process.exit(result.ok ? 0 : 1);
};
try {
  await page.goto(co.url, { waitUntil: "domcontentloaded" });
  const fill = async (sel, v) => {
    const el = page.locator(sel).first();
    await el.waitFor({ timeout: 20000 });
    await el.fill(v);
  };
  await fill("#email", "checkout-tester@example.com");
  // Stripe shows a payment-method picker first (Card, Cash App, Klarna, …).
  const card = page.getByRole("button", { name: "Pay with card" });
  await card.waitFor({ state: "attached", timeout: 20000 });
  await card.evaluate((el) => el.click());
  await fill("#cardNumber", "4242424242424242");
  await fill("#cardExpiry", "12 / 34");
  await fill("#cardCvc", "123");
  await fill("#billingName", "Checkout Tester");
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill("84101");
  // Link's "save my information" is pre-ticked and then wants a phone number.
  const link = page.locator("#enableStripePass");
  if (await link.isChecked().catch(() => false)) await link.uncheck({ force: true });
  await page.locator(".SubmitButton, button[type=submit]").first().click();
  await page.waitForURL(/example\.com\/bought/, { timeout: 60000 });
} catch (e) {
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  await done({ ok: false, step: "stripe page", error: String(e).slice(0, 300) });
}
const paid_ms = Date.now() - t0;
// The webhook lands within seconds.
let owns = false;
for (let i = 0; i < 40 && !owns; i++) {
  const e = await api("GET", `/v1/players/me/entitlements?game=${game}`, null, token);
  owns = (e.entitlements ?? []).some((x) => x.game === game && x.sku === "full" && x.source === "stripe");
  if (!owns) await new Promise((r) => setTimeout(r, 500));
}
await done({
  ok: owns && (before.entitlements ?? []).length === 0,
  game,
  player: guest.player?.id,
  paid_ms,
  granted_ms: Date.now() - t0,
  checks: { owned_nothing_before: (before.entitlements ?? []).length === 0, webhook_granted_full: owns },
});
