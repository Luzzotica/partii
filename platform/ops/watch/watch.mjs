// partii watch: a small always-on process on the owner's Mac that turns
// platform events into k2 pings. Every 30 s it checks production:
//   * health: down for 3 checks in a row → a k2 ticket for the owner (and one when it's back);
//   * usage alerts (adminUsage) → a k2 ticket for the owner, once per alert;
//   * player content waiting for review → wakes the moderator agent (k2 msg --inbox-wake);
//     content left unreviewed for 30 minutes → a k2 ticket for the owner;
//   * errors (crashes, failed requests, failed purchases) of the games in
//     WATCH_ERRORS (default partii=partii-backend: partii's own) → wakes the
//     agent that owns the game, with the error, for each new group and again
//     when a known one keeps happening (at most hourly); a failed purchase
//     also tickets the owner. Needs WATCH_DEV_TOKEN (a developer token that
//     owns those games: partii tokens create --name partii-watch).
// No dependencies. Config (names only in git): ~/.config/partii/watch.env with
// PARTII_API, PARTII_ADMIN_TOKEN, and optionally WATCH_OWNER (default luzzotica),
// WATCH_MODERATOR (default partii-moderator), WATCH_K2_WORKSPACE (where tickets come from),
// WATCH_DEV_TOKEN and WATCH_ERRORS (game=agent,game=agent).
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
const ERROR_REPEAT_MS = 60 * 60_000;
/** Errors from these API operations are failed purchases. */
const PURCHASE = /^(storeCheckout|webhookStripe|playersReceipt|checkout|download)\b/;

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
const DEV = env.WATCH_DEV_TOKEN;
const ERROR_GAMES = (env.WATCH_ERRORS ?? "partii=partii-backend")
  .split(",")
  .map((p) => p.trim().split("="))
  .filter(([g, a]) => g && a);
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

async function get(path, token = ADMIN) {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}`, "user-agent": "partii-watch/1" }, signal: AbortSignal.timeout(15_000) });
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

const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []).join(", ");

/** New error groups, and known ones still happening, go to the agent that owns the game. */
async function checkErrors(s) {
  if (!DEV) return;
  s.errors ??= {};
  for (const [game, agent] of ERROR_GAMES) {
    const { groups } = await get(`/v1/games/${game}/errors?status=open&limit=50`, DEV);
    const seen = (s.errors[game] ??= { told: {}, since: null });
    const first = seen.since === null;
    seen.since ??= Date.now();
    const tell = [];
    for (const g of groups) {
      const t = seen.told[g.fingerprint];
      // First run: only what happens from now on.
      if (first) {
        seen.told[g.fingerprint] = { count: g.count, at: Date.now() };
        continue;
      }
      const isNew = !t;
      const growing = t && g.count > t.count && Date.now() - t.at > ERROR_REPEAT_MS;
      if (!isNew && !growing) continue;
      tell.push({ g, isNew, more: t ? g.count - t.count : g.count });
      seen.told[g.fingerprint] = { count: g.count, at: Date.now() };
    }
    if (!tell.length) continue;
    const lines = tell.map(({ g, isNew, more }) =>
      [
        `## ${isNew ? "NEW" : `still happening (+${more})`}: ${g.kind}: ${g.message}`,
        `- fingerprint ${g.fingerprint}; ${g.count} reports from ${g.devices} devices; first ${new Date(g.first_seen).toISOString()}, last ${new Date(g.last_seen).toISOString()}`,
        `- versions ${list(g.versions) || "?"}; platforms ${list(g.platforms) || "?"}${g.top_frame ? `; top frame ${g.top_frame}` : ""}`,
        `- details and samples: partii errors get ${game} ${g.fingerprint}; when fixed and deployed: partii errors update ${game} ${g.fingerprint} --status fixed`,
      ].join("\n"),
    );
    const file = join(CONF, `watch-errors-${game}.md`);
    writeFileSync(file, `# Errors in ${game} on ${API}\n\nFix what's yours, deploy, and mark it fixed (a fixed group that comes back reopens).\n\n${lines.join("\n\n")}\n`);
    log("wake", agent, "with", tell.length, "error groups of", game);
    k2(["msg", agent, "--inbox-wake", file]);
    const money = tell.filter(({ g }) => PURCHASE.test(g.message) && g.kind !== "warning");
    if (money.length) tellOwner(`Purchases are failing on ${game}`, `${money.map(({ g }) => `${g.message} (${g.count}×)`).join("; ")}. ${agent} has been woken to fix it.`);
  }
}

async function tick() {
  const s = loadState();
  if (await checkHealth(s)) {
    for (const check of [checkAlerts, checkReview, checkErrors]) {
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
