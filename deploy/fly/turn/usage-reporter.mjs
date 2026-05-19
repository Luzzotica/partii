// usage-reporter — spawn coturn, parse its stdout for session usage lines,
// batch-POST to Vercel's /api/turn/usage so we can show customers their
// bandwidth.
//
// coturn emits two relevant lines per session:
//
//   1. Periodically + on close:
//      "... session 000000000000000001: usage: realm=<...>, username=<...>,
//       rp=N, rb=N, sp=N, sb=N"
//      (rp/sb = received packets/sent bytes etc.)
//
//   2. At close:
//      "... session 000000000000000001: closed (...), ..."
//
// We track the latest usage per session in memory, and on close emit a row
// to Vercel. The username embeds the API key id (k=<apiKeyId>:p=<peerTag>)
// because Vercel signed it — so the attribution is trustworthy.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const COTURN_BIN = process.env.COTURN_BIN ?? "/usr/bin/turnserver";
const COTURN_CONF = process.env.COTURN_CONF ?? "/etc/coturn/turnserver.conf";
const TURN_REALM = process.env.TURN_REALM ?? "arcade-turn.fly.dev";
const TURN_SHARED_SECRET = process.env.TURN_SHARED_SECRET;

const USAGE_API_URL = process.env.USAGE_API_URL ?? "";
const USAGE_API_TOKEN = process.env.USAGE_API_TOKEN ?? "";
const FLUSH_INTERVAL_MS = Number(process.env.USAGE_FLUSH_MS ?? 10_000);
const MAX_BATCH = Number(process.env.USAGE_MAX_BATCH ?? 100);

if (!TURN_SHARED_SECRET) {
  console.error("[reporter] TURN_SHARED_SECRET is required");
  process.exit(1);
}
const reportingEnabled = !!USAGE_API_URL && !!USAGE_API_TOKEN;
if (!reportingEnabled) {
  console.error(
    "[reporter] USAGE_API_URL/USAGE_API_TOKEN not set — running coturn without usage reporting",
  );
}

// ─── State ────────────────────────────────────────────────────────────────────

/** sessions: sessionId -> { username, realm, rb, sb, rp, sp, firstSeen, lastSeen } */
const sessions = new Map();
const pending = []; // queued usage events ready to ship

// ─── Parsers ──────────────────────────────────────────────────────────────────

const USAGE_RE =
  /session\s+(\d+):\s.*usage:.*realm=<([^>]*)>,\s*username=<([^>]*)>,\s*rp=(\d+),\s*rb=(\d+),\s*sp=(\d+),\s*sb=(\d+)/;
const CLOSE_RE = /session\s+(\d+):\s+closed/;

function parseUsername(username) {
  // Expected: "<expiry>:k=<apiKeyId>:p=<peerTag>"
  const m = /^(\d+):k=([^:]+):p=(.*)$/.exec(username);
  if (!m) return null;
  return { apiKeyId: m[2], peerTag: m[3] };
}

function handleLine(line) {
  const u = USAGE_RE.exec(line);
  if (u) {
    const [, sid, realm, username, rp, rb, sp, sb] = u;
    const now = new Date().toISOString();
    const s = sessions.get(sid) ?? { firstSeen: now };
    s.username = username;
    s.realm = realm;
    s.rp = Number(rp);
    s.rb = Number(rb);
    s.sp = Number(sp);
    s.sb = Number(sb);
    s.lastSeen = now;
    sessions.set(sid, s);
    return;
  }
  const c = CLOSE_RE.exec(line);
  if (c) {
    const sid = c[1];
    const s = sessions.get(sid);
    sessions.delete(sid);
    if (!s || !s.username) return;
    const parsed = parseUsername(s.username);
    if (!parsed) return;
    pending.push({
      session_id: sid,
      api_key_id: parsed.apiKeyId,
      peer_tag: parsed.peerTag,
      realm: s.realm ?? TURN_REALM,
      bytes_sent: s.sb ?? 0,
      bytes_received: s.rb ?? 0,
      packets_sent: s.sp ?? 0,
      packets_received: s.rp ?? 0,
      started_at: s.firstSeen ?? null,
      ended_at: new Date().toISOString(),
    });
    if (pending.length >= MAX_BATCH) void flush("size");
  }
}

// ─── Flushing ─────────────────────────────────────────────────────────────────

let flushing = false;

async function flush(reason) {
  if (flushing || pending.length === 0 || !reportingEnabled) return;
  flushing = true;
  const batch = pending.splice(0, MAX_BATCH);
  try {
    const res = await fetch(`${USAGE_API_URL.replace(/\/$/, "")}/api/turn/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${USAGE_API_TOKEN}`,
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[reporter] usage POST failed ${res.status}: ${text}`);
      // Requeue at the head — try again next interval.
      pending.unshift(...batch);
    } else {
      const body = await res.json().catch(() => ({}));
      console.error(`[reporter] flushed (${reason}): ${batch.length} events, inserted=${body.inserted ?? "?"}`);
    }
  } catch (err) {
    console.error(`[reporter] usage POST error: ${err?.message ?? err}`);
    pending.unshift(...batch);
  } finally {
    flushing = false;
  }
}

setInterval(() => { void flush("tick"); }, FLUSH_INTERVAL_MS).unref();

// ─── Spawn coturn ─────────────────────────────────────────────────────────────

const args = [
  "-c", COTURN_CONF,
  `--static-auth-secret=${TURN_SHARED_SECRET}`,
  `--realm=${TURN_REALM}`,
];

console.error(`[reporter] starting coturn: ${COTURN_BIN} ${args.map(a => a.startsWith("--static-auth") ? "--static-auth-secret=***" : a).join(" ")}`);

const coturn = spawn(COTURN_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

const onLine = (line) => {
  // Mirror to our stderr so Fly logs still see the raw stream.
  process.stdout.write(line + "\n");
  try { handleLine(line); } catch (err) {
    console.error(`[reporter] parse error: ${err?.message ?? err}`);
  }
};

createInterface({ input: coturn.stdout }).on("line", onLine);
createInterface({ input: coturn.stderr }).on("line", onLine);

coturn.on("exit", (code, signal) => {
  console.error(`[reporter] coturn exited code=${code} signal=${signal}; flushing pending`);
  void flush("exit").finally(() => process.exit(code ?? 1));
});

const shutdown = (sig) => {
  console.error(`[reporter] received ${sig}, forwarding to coturn`);
  coturn.kill(sig);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
