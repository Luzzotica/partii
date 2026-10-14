// partii watch: a small always-on process on the owner's Mac that turns
// platform events into k2 pings. Every 30 s it checks production:
//   * health: down for 3 checks in a row → a k2 ticket for the owner (and one when it's back);
//   * usage alerts (adminUsage) → a k2 ticket for the owner, once per alert;
//   * player content waiting for review → wakes the moderator agent (k2 msg --inbox-wake);
//     content left unreviewed for 30 minutes → a k2 ticket for the owner.
// No dependencies. Config (names only in git): ~/.config/partii/watch.env with
// PARTII_API, PARTII_ADMIN_TOKEN, and optionally WATCH_OWNER (default luzzotica),
// WATCH_MODERATOR (default partii-moderator), WATCH_K2_WORKSPACE (where tickets come from).
// Run: node watch.mjs [--once]   (installed as a LaunchAgent by install.sh)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONF = join(homedir(), ".config/partii");
const STATE = process.env.WATCH_STATE ?? join(CONF, "watch-state.json");
const EVERY_MS = 30_000;
const DOWN_AFTER = 3;
const STALE_REVIEW_MS = 30 * 60_000;

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(join(CONF, "watch.env")), ...process.env };
const API = (env.PARTII_API ?? "").replace(/\/$/, "");
const ADMIN = env.PARTII_ADMIN_TOKEN;
const OWNER = env.WATCH_OWNER ?? "luzzotica";
const MODERATOR = env.WATCH_MODERATOR ?? "partii-moderator";
const WORKSPACE = env.WATCH_K2_WORKSPACE ?? process.cwd();
if (!API || !ADMIN) throw new Error("set PARTII_API and PARTII_ADMIN_TOKEN in ~/.config/partii/watch.env");

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    // First run: only what happens from now on.
    return { alertsSince: Date.now(), notifiedSeq: null, staleTold: null, failures: 0, down: false };
  }
}
const saveState = (s) => (mkdirSync(CONF, { recursive: true }), writeFileSync(STATE, JSON.stringify(s, null, 2)));
const log = (...a) => console.log(new Date().toISOString(), ...a);

function k2(args) {
  try {
    return execFileSync("k2", args, { cwd: WORKSPACE, env: { ...process.env, K2_PROJECT_PATH: WORKSPACE }, encoding: "utf8", timeout: 60_000 });
  } catch (e) {
    log("k2 failed:", args.slice(0, 2).join(" "), String(e.stderr ?? e.message).slice(0, 300));
    return null;
  }
}

/** A ticket for the owner (their k2 app notifies them). */
function tellOwner(title, body) {
  const file = join(CONF, "watch-ticket.html");
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  writeFileSync(file, `<h2>What happened</h2><p>${esc(body)}</p><p class="k2-callout">From partii watch (platform/ops/watch). partii-backend can look into it: message it in k2.</p>`);
  log("ticket:", title);
  k2(["tickets", "ask", title, "--html", file, "--assign", OWNER]);
}

async function get(path) {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${ADMIN}`, "user-agent": "partii-watch/1" }, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${path}: HTTP ${r.status} ${j.error?.code ?? ""}`);
  return j;
}

async function checkHealth(s) {
  let ok = false;
  try {
    ok = (await fetch(`${API}/health`, { headers: { "user-agent": "partii-watch/1" }, signal: AbortSignal.timeout(10_000) })).ok;
  } catch {
    ok = false;
  }
  if (ok) {
    if (s.down) tellOwner("partii is back up", `${API} answers again after ${s.failures} failed checks.`);
    s.failures = 0;
    s.down = false;
    return true;
  }
  s.failures++;
  if (!s.down && s.failures >= DOWN_AFTER) {
    s.down = true;
    tellOwner("partii is DOWN", `${API}/health has failed ${s.failures} checks in a row (${Math.round((s.failures * EVERY_MS) / 1000)} s). Games can't create or join rooms.`);
  }
  return false;
}

async function checkAlerts(s) {
  const { projects } = await get("/v1/admin/usage");
  const fresh = projects.flatMap((p) => (p.alerts ?? []).map((a) => ({ ...a, project: a.project ?? p.project }))).filter((a) => a.at > s.alertsSince);
  for (const a of fresh.sort((x, y) => x.at - y.at)) {
    tellOwner(`partii alert: ${a.project} ${a.metric}`, `Project ${a.project} has ${a.value} ${a.metric} (alert at ${a.threshold}), at ${new Date(a.at).toISOString()}. Usage: partii admin usage --project ${a.project}.`);
    s.alertsSince = Math.max(s.alertsSince, a.at);
  }
}

async function checkReview(s) {
  let q;
  try {
    q = await get("/v1/admin/ugc/review?limit=1");
  } catch (e) {
    if (String(e).includes("not_available") || String(e).includes("404")) return; // no player content here
    throw e;
  }
  if (!q.pending) {
    s.staleTold = null;
    return;
  }
  if (q.last_seq !== s.notifiedSeq) {
    const file = join(CONF, "watch-review.md");
    writeFileSync(file, `# Player content to review\n\n${q.pending} entr${q.pending === 1 ? "y" : "ies"} waiting (newest seq ${q.last_seq}) on ${API}.\nWork through the queue now (see your ROLE.md).\n`);
    log("wake moderator:", q.pending, "pending");
    if (k2(["msg", MODERATOR, "--inbox-wake", file]) !== null) s.notifiedSeq = q.last_seq;
  }
  const oldest = q.entries[0];
  if (oldest && Date.now() - oldest.queued_at > STALE_REVIEW_MS && s.staleTold !== oldest.seq) {
    tellOwner("Player content is waiting for review", `${q.pending} player content entries are waiting; the oldest has waited ${Math.round((Date.now() - oldest.queued_at) / 60_000)} minutes. Is the ${MODERATOR} agent running?`);
    s.staleTold = oldest.seq;
  }
}

async function tick() {
  const s = loadState();
  if (await checkHealth(s)) {
    for (const check of [checkAlerts, checkReview]) {
      try {
        await check(s);
      } catch (e) {
        log(check.name, "failed:", String(e));
      }
    }
  }
  saveState(s);
}

log("partii watch:", API, "owner", OWNER, "moderator", MODERATOR);
await tick();
if (!process.argv.includes("--once")) setInterval(() => tick().catch((e) => log("tick failed:", String(e))), EVERY_MS);
