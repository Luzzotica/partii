// Drives bot.ts in headless Chromium and prints its JSON lines to stdout.
//   node run.mjs host|guest --api URL --key K [--code C] [--secs N] [--trace]
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const role = args[0];
const params = new URLSearchParams({
  role,
  api: arg("--api", "https://www.sterlinglong.me"),
  key: arg("--key", process.env.LEGACY_API_KEY ?? ""),
  code: arg("--code", ""),
  secs: arg("--secs", "20"),
  kind: arg("--kind", "screen"),
  trace: args.includes("--trace") ? "1" : "0",
});
const js = readFileSync(join(here, "dist/bot.js"));
const server = createServer((req, res) => {
  if (req.url.startsWith("/bot.js")) { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(js); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end('<!doctype html><script type="module" src="/bot.js"></script>');
}).listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const page = await browser.newPage();
  let done;
  const finished = new Promise((r) => (done = r));
  page.on("console", (m) => {
    const t = m.text();
    if (!t.startsWith("{")) return;
    console.log(t);
    if (t.includes('"ev":"done"')) done();
  });
  await page.goto(`http://localhost:${port}/?${params}`);
  await finished;
  await browser.close();
  server.close();
});
