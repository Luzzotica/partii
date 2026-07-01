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
import { lookup } from "node:dns/promises";
import { createLineConsumer } from "./parser.mjs";

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

const pending = []; // queued usage events ready to ship
const consumeLine = createLineConsumer();

function handleLine(line) {
  const result = consumeLine(line);
  if (!result) return;
  const event = { ...result.event };
  // Fill realm default if coturn didn't surface one on the usage line.
  if (!event.realm) event.realm = TURN_REALM;
  pending.push(event);
  if (pending.length >= MAX_BATCH) void flush("size");
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

// On Fly the container only sees its private internal NIC; the public
// dedicated IP is mapped by Fly's edge. coturn binds to 0.0.0.0 fine, but
// when a client ALLOCATES a relay, coturn advertises whatever local IP its
// socket sees — i.e. the private Fly IP — which the remote peer can't
// reach. `--external-ip=<PUBLIC>` tells coturn to advertise the public IP
// in ALLOCATION responses while keeping the local bind. Without this,
// every TURN-relay candidate is born unroutable and ICE silently fails.
const TURN_EXTERNAL_IP = process.env.TURN_EXTERNAL_IP;

// Fly UDP requires binding to `fly-global-services` — Linux picks the wrong
// source address on `0.0.0.0` replies and the edge proxy drops them. Resolve
// it now so we can pass IP literals to coturn (which doesn't do DNS for
// listening-ip / relay-ip).
let flyGlobalIp = null;
try {
  const { address } = await lookup("fly-global-services", { family: 4 });
  flyGlobalIp = address;
  console.error(`[reporter] resolved fly-global-services → ${flyGlobalIp}`);
} catch (err) {
  console.error(
    `[reporter] failed to resolve fly-global-services (${err?.message ?? err}); falling back to 0.0.0.0 bind — UDP will likely not work.`,
  );
}

const args = [
  "-c", COTURN_CONF,
  `--static-auth-secret=${TURN_SHARED_SECRET}`,
  `--realm=${TURN_REALM}`,
];
if (flyGlobalIp) {
  args.push(`--listening-ip=${flyGlobalIp}`);
  args.push(`--relay-ip=${flyGlobalIp}`);
}
if (TURN_EXTERNAL_IP) {
  args.push(`--external-ip=${TURN_EXTERNAL_IP}`);
} else {
  console.error(
    "[reporter] TURN_EXTERNAL_IP not set — relay candidates will advertise the container's private IP and clients won't be able to reach the relay. Set via `fly secrets set TURN_EXTERNAL_IP=<public v4>`.",
  );
}

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
