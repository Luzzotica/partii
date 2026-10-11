// Baseline web bot: today's party-kit TS (what players ran in browsers),
// driven headless by run.mjs. Same JSON-line contract as legacy-bot and
// `partii bot` (see ../legacy-bot/src/main.rs).
import { createHostRoom, joinAsPeer, RoomService } from "../../../../packages/party-kit/src/index";

const q = new URLSearchParams(location.search);
const role = q.get("role")!;
const api = q.get("api")!;
const key = q.get("key")!;
const secs = Number(q.get("secs") ?? "20");
const kind = q.get("kind") ?? "screen";
const trace = q.get("trace") === "1";
const out = (v: Record<string, unknown>) => console.log(JSON.stringify(v));
const cfg = { baseUrl: api, apiKey: key, gameId: "tankii-torture", platform: "dev" };
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);

async function host() {
  let mgr: any;
  const { result, room, manager } = await createHostRoom(cfg, { game_id: "tankii-torture", max_peers: 4 } as any, {
    onMessage: (peer, channel, data) => mgr.send(peer, channel, data),
    onPeerConnected: (peer) => out({ ev: "peer", peer }),
    onPhase: (peer, phase, detail) => {
      if (phase === "connected" || phase === "selected") out({ ev: "selected", detail });
      if (trace) out({ ev: "trace", side: "host", phase, detail });
    },
  });
  mgr = manager;
  out({ ev: "created", code: result.join_code, ms: ms() });
  // The game dials joiners it discovers by polling the roster (2 s, as the
  // TS games did: tankii Host.tsx).
  const dialed = new Set<string>();
  setInterval(async () => {
    try {
      const r: any = await room.getRoom();
      for (const p of r.peers ?? []) {
        if (p.is_host || dialed.has(p.peer_id) || p.status === "disconnected") continue;
        dialed.add(p.peer_id);
        if (trace) out({ ev: "trace", side: "host", phase: "dial", detail: p });
        manager.connectTo(p.peer_id, p.kind);
      }
    } catch (e) {
      if (trace) out({ ev: "trace", side: "host", phase: "poll-error", detail: String(e) });
    }
  }, 2000);
  setTimeout(() => out({ ev: "done" }), (secs + 60) * 1000);
}

async function guest() {
  const code = q.get("code")!;
  const svc = new RoomService(cfg);
  let room;
  try {
    room = await svc.lookupByCode(code);
  } catch (e) {
    out({ ev: "error", msg: `lookup: ${e}`, ms: ms() });
    return out({ ev: "done" });
  }
  let hostPeer: string | null = null;
  let rung: string | null = null;
  let connectedAt = 0;
  let sent = 0;
  let lastEcho = 0;
  let longestGap = 0;
  const rtts: number[] = [];
  const echoTimes: number[] = [];
  let mgr: any;
  try {
    const { manager } = await joinAsPeer(cfg, (room as any).room_id ?? (room as any).id, { kind } as any, {
      onPeerConnected: (peer) => (hostPeer = peer),
      onPeerDisconnected: () => out({ ev: "lost", at_ms: ms() }),
      onPhase: (_p, phase, detail) => {
        const ct = (detail as any)?.candidateType ?? (detail as any)?.candidate_type ?? (detail as any)?.localCandidateType;
        if (ct) rung = String(ct);
        if (trace) out({ ev: "trace", side: "guest", phase, detail });
      },
      onMessage: (_peer, _ch, data) => {
        if (!(data instanceof ArrayBuffer) || data.byteLength !== 8) return;
        const stamp = new Float64Array(data)[0];
        const now = performance.now();
        if (connectedAt && now - lastEcho > 500) out({ ev: "gap", ms: Math.round(now - lastEcho) });
        lastEcho = now;
        if (!connectedAt) {
          connectedAt = now;
          const at = ms();
          const t: any = mgr?.getAllTransports?.()[0];
          pairKind(t?.pc).then((k) => {
            rung = k ?? rung;
            out({ ev: "connected", ms: at, rung });
          });
          setTimeout(finish, secs * 1000);
        }
        rtts.push(now - stamp);
        echoTimes.push(now);
      },
    });
    mgr = manager;
  } catch (e) {
    out({ ev: "error", msg: `join: ${e}`, ms: ms() });
    return out({ ev: "done" });
  }
  out({ ev: "joined", ms: ms() });
  const tick = setInterval(() => {
    if (hostPeer && mgr.send(hostPeer, "input", new Float64Array([performance.now()]).buffer)) sent++;
    if (connectedAt) longestGap = Math.max(longestGap, performance.now() - lastEcho);
  }, 50);
  const deadline = setTimeout(() => {
    if (!connectedAt) {
      out({ ev: "error", msg: "no echo within 30 s", ms: ms(), rung });
      finish();
    }
  }, 30000);
  function finish() {
    clearInterval(tick);
    clearTimeout(deadline);
    rtts.sort((a, b) => a - b);
    const pct = (p: number) => (rtts.length ? Math.round(rtts[Math.round((rtts.length - 1) * p)] * 10) / 10 : null);
    const tail = echoTimes.filter((t) => performance.now() - t < 3000).length;
    out({ ev: "summary", sent, echoed: rtts.length, tail_echoes: tail, rtt_p50: pct(0.5), rtt_p95: pct(0.95), longest_gap_ms: Math.round(longestGap), rung });
    out({ ev: "done" });
  }
}

(role === "host" ? host() : guest()).catch((e) => {
  out({ ev: "error", msg: String(e), ms: ms() });
  out({ ev: "done" });
});

// "relay" when either end of the selected pair is a TURN relay, else "direct".
async function pairKind(pc: RTCPeerConnection | undefined): Promise<string | null> {
  if (!pc) return null;
  const stats = await pc.getStats();
  const byId = new Map<string, any>();
  stats.forEach((s: any) => byId.set(s.id, s));
  let pair: any = null;
  stats.forEach((s: any) => {
    if (s.type === "transport" && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId);
  });
  if (!pair) stats.forEach((s: any) => { if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pair = s; });
  if (!pair) return null;
  const l = byId.get(pair.localCandidateId)?.candidateType;
  const r = byId.get(pair.remoteCandidateId)?.candidateType;
  return l === "relay" || r === "relay" ? "relay" : "direct";
}
