// node run.mjs --edge URL --key K --code C [--secs N] [--ws]
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try { res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1", async () => {
  const q = new URLSearchParams({ edge: arg("--edge"), key: arg("--key"), code: arg("--code"), secs: arg("--secs", "6"), ws: a.includes("--ws") ? "1" : "0" });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let done; const fin = new Promise((r) => (done = r));
  page.on("console", (m) => { const t = m.text(); if (t.startsWith("{")) { console.log(t); if (t.includes('"done"')) done(); } else if (m.type() === "error") console.error(t); });
  page.on("pageerror", (e) => { console.error("pageerror", e.message); done(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/test/index.html?${q}`);
  await Promise.race([fin, new Promise((r) => setTimeout(r, 40000))]);
  await browser.close(); server.close();
});
