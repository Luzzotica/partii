// ─────────────────────────────────────────────────────────────────────────────
// arcade-signal — realtime signal push gateway.
//
// Kills the 1.5s polling latency on the WebRTC handshake: game clients hold a
// WebSocket here for the whole session and receive signals the instant the
// rooms API stores them. Postgres stays the source of truth — clients keep a
// relaxed poll running as reconciliation, deduping by signal id — so this
// gateway can die, restart, or drop messages with zero correctness impact.
//
//   Client:  WSS /rooms/<roomId>?token=<room_token>
//            → server pushes {"type":"signal","signal":{…}} frames
//   partii:   POST /push  (Authorization: Bearer $SIGNAL_GW_TOKEN)
//            {room_id, recipient_peer_id, signal} → fan out to that peer
//
// Auth: room tokens are per-room per-peer scoped HS256 JWTs minted by partii
// (lib/api/roomToken.ts) and verified here with the same shared secret. A
// token authorizes exactly ONE peer's channel in ONE room — no global key ever
// reaches this service. Expiry is checked at connect; rooms live ≲2h and
// tokens are capped at 6h, so mid-session expiry is not enforced.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.SESSION_TOKEN_SECRET;
const PUSH_TOKEN = process.env.SIGNAL_GW_TOKEN;
if (!SECRET || !PUSH_TOKEN) {
  console.error("SESSION_TOKEN_SECRET and SIGNAL_GW_TOKEN are required");
  process.exit(1);
}

const HEARTBEAT_MS = 15_000;

// ─── Room-token verification (mirror of partii lib/api/roomToken.ts) ─────────

function verifyRoomToken(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.t !== "room" || !claims.rid || !claims.peer) return null;
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) >= claims.exp) return null;
  return claims;
}

// ─── Subscriber registry: `${roomId}:${peerId}` → Set<ws> ───────────────────

const subs = new Map();
const keyOf = (roomId, peerId) => `${roomId}:${peerId}`;

function subscribe(key, ws) {
  let set = subs.get(key);
  if (!set) {
    set = new Set();
    subs.set(key, set);
  }
  set.add(ws);
}

function unsubscribe(key, ws) {
  const set = subs.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subs.delete(key);
}

// ─── HTTP: health + internal push webhook ────────────────────────────────────

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, subscribers: subs.size }));
    return;
  }
  if (req.method === "POST" && req.url === "/push") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${PUSH_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 256 * 1024) req.destroy(); // signals are small; cap abuse
    });
    req.on("end", () => {
      try {
        const { room_id, recipient_peer_id, signal } = JSON.parse(body);
        const set = subs.get(keyOf(room_id, recipient_peer_id));
        let delivered = 0;
        if (set) {
          const frame = JSON.stringify({ type: "signal", signal });
          for (const ws of set) {
            if (ws.readyState === ws.OPEN) {
              ws.send(frame);
              delivered += 1;
            }
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ delivered }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(404).end();
});

// ─── WebSocket subscriptions ─────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const m = /^\/rooms\/([0-9a-f-]{36})$/i.exec(url.pathname);
  const claims = m ? verifyRoomToken(url.searchParams.get("token")) : null;
  if (!m || !claims || claims.rid !== m[1]) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const key = keyOf(claims.rid, claims.peer);
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (data) => {
      // Clients may app-level ping (WS libs without frame ping access).
      try {
        if (JSON.parse(data.toString()).type === "ping") {
          ws.send('{"type":"pong"}');
        }
      } catch { /* ignore non-JSON */ }
    });
    ws.on("close", () => unsubscribe(key, ws));
    ws.on("error", () => unsubscribe(key, ws));
    subscribe(key, ws);
    ws.send(JSON.stringify({ type: "hello", room_id: claims.rid, peer_id: claims.peer }));
  });
});

// Heartbeat: drop dead sockets so the registry can't grow unbounded.
setInterval(() => {
  for (const set of subs.values()) {
    for (const ws of set) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => console.log(`arcade-signal listening on :${PORT}`));
