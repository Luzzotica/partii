// Coturn stdout parser — shared between the live wrapper (usage-reporter.mjs)
// and the unit tests in hexii/tests/turn/parser.test.ts. Keep this file pure
// (no I/O, no globals) so both can rely on the same regexes.
//
// Two relevant log shapes:
//
//   "... session 000000000000000001: ... usage: realm=<...>, username=<...>,
//        rp=N, rb=N, sp=N, sb=N"
//   "... session 000000000000000001: closed (...), ..."

export const USAGE_RE =
  /session\s+(\d+):\s.*usage:.*realm=<([^>]*)>,\s*username=<([^>]*)>,\s*rp=(\d+),\s*rb=(\d+),\s*sp=(\d+),\s*sb=(\d+)/;

export const CLOSE_RE = /session\s+(\d+):\s+closed/;

/**
 * Extract `{apiKeyId, peerTag}` from a TURN username of the shape
 * `<expiry>:k=<apiKeyId>:p=<peerTag>`. Returns null if the username
 * doesn't match — that's typical for hand-rolled credentials made
 * outside of hexii/lib/api/turn.ts (e.g. the Trickle ICE manual test).
 */
export function parseUsername(username) {
  const m = /^(\d+):k=([^:]+):p=(.*)$/.exec(username);
  if (!m) return null;
  return { expiry: Number(m[1]), apiKeyId: m[2], peerTag: m[3] };
}

/**
 * Stateful line consumer. Create one per process. Feed it coturn stdout lines;
 * it emits a finalized event each time a session closes.
 *
 * Returns `{ event } | null`:
 *   - `null` when the line is unrelated or only partial info (e.g. usage
 *     update without a close yet).
 *   - `{ event }` when a `closed` line flushes the buffered session.
 */
export function createLineConsumer() {
  const sessions = new Map();

  return function handle(line) {
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
      return null;
    }
    const c = CLOSE_RE.exec(line);
    if (c) {
      const sid = c[1];
      const s = sessions.get(sid);
      sessions.delete(sid);
      if (!s || !s.username) return null;
      const parsed = parseUsername(s.username);
      if (!parsed) return null;
      const event = {
        session_id: sid,
        api_key_id: parsed.apiKeyId,
        peer_tag: parsed.peerTag,
        realm: s.realm,
        bytes_sent: s.sb ?? 0,
        bytes_received: s.rb ?? 0,
        packets_sent: s.sp ?? 0,
        packets_received: s.rp ?? 0,
        started_at: s.firstSeen ?? null,
        ended_at: new Date().toISOString(),
      };
      return { event };
    }
    return null;
  };
}

/** Internal — exported only for tests that want to inspect buffered state. */
export function activeSessionCount(consumer) {
  // Walk the closure's prototype to peek at the map size.
  // We re-derive by funneling a no-op line through `handle` — the consumer
  // doesn't expose its internal map directly, but this is the simplest stable
  // signal for tests. (We just return -1 here as a sentinel; tests that need
  // size should track it themselves via observed emissions.)
  return -1;
}
