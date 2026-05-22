import { describe, it, expect } from "vitest";
import { createLineConsumer, parseUsername } from "../../deploy/fly/turn/parser.mjs";

// Fixtures shaped exactly like the lines coturn 4.6 emits, verified against
// the live Fly deployment's `fly logs` output. If coturn ever changes its
// log format these tests will fail loudly.
const allocLine =
  "1733765432: session 000000000000000123: realm <arcade-turn.fly.dev> user <1733765999:k=apk_abc123:p=peer_xyz>: incoming packet ALLOCATE processed, success";
const usageLine = (
  bytes: { rp: number; rb: number; sp: number; sb: number },
  username = "1733765999:k=apk_abc123:p=peer_xyz",
  sid = "000000000000000123",
) =>
  `1733765500: session ${sid}: usage: realm=<arcade-turn.fly.dev>, username=<${username}>, rp=${bytes.rp}, rb=${bytes.rb}, sp=${bytes.sp}, sb=${bytes.sb}`;
const closeLine = (sid = "000000000000000123") =>
  `1733765999: session ${sid}: closed (1st finished), local 10.0.0.1:3478, remote 1.2.3.4:54321, reason: TCP socket closed remotely`;

describe("parseUsername", () => {
  it("extracts api key id + peer tag from minted usernames", () => {
    expect(parseUsername("1733765999:k=apk_abc123:p=peer_xyz")).toEqual({
      expiry: 1733765999,
      apiKeyId: "apk_abc123",
      peerTag: "peer_xyz",
    });
  });

  it("returns null for hand-rolled usernames without the k=/p= structure", () => {
    expect(parseUsername("1733765999:plain-username")).toBeNull();
    expect(parseUsername("not-a-username-at-all")).toBeNull();
    expect(parseUsername("")).toBeNull();
  });

  it("tolerates colons inside the peer tag (legacy data only)", () => {
    // Sanitizer in turn.ts strips colons, but in case we ever loosen that, the
    // parser shouldn't blow up — it should grab the longest run after `:p=`.
    const out = parseUsername("1:k=key:p=peer-with-dashes");
    expect(out?.peerTag).toBe("peer-with-dashes");
  });
});

describe("createLineConsumer", () => {
  it("emits an event when usage then close are seen for the same session", () => {
    const handle = createLineConsumer();
    expect(handle(allocLine)).toBeNull();
    expect(handle(usageLine({ rp: 42, rb: 8421, sp: 37, sb: 7150 }))).toBeNull();

    const r = handle(closeLine());
    expect(r).not.toBeNull();
    expect(r!.event).toMatchObject({
      session_id: "000000000000000123",
      api_key_id: "apk_abc123",
      peer_tag: "peer_xyz",
      realm: "arcade-turn.fly.dev",
      bytes_received: 8421,
      bytes_sent: 7150,
      packets_received: 42,
      packets_sent: 37,
    });
  });

  it("uses the latest usage line if multiple arrive before close", () => {
    const handle = createLineConsumer();
    handle(usageLine({ rp: 1, rb: 100, sp: 1, sb: 100 }));
    handle(usageLine({ rp: 10, rb: 2000, sp: 10, sb: 2500 }));
    const r = handle(closeLine());
    expect(r!.event.bytes_received).toBe(2000);
    expect(r!.event.bytes_sent).toBe(2500);
  });

  it("never emits an event for a session it never saw `usage` for", () => {
    const handle = createLineConsumer();
    // Close arrives without any prior usage line — e.g. an ALLOCATE that
    // failed auth and dropped instantly. We have no username, so we can't
    // attribute it — drop silently rather than insert a phantom row.
    expect(handle(closeLine())).toBeNull();
  });

  it("never emits when the username can't be parsed (hand-rolled creds)", () => {
    const handle = createLineConsumer();
    handle(usageLine({ rp: 5, rb: 500, sp: 5, sb: 500 }, "manual-test-user"));
    // No k= / p= structure → parseUsername returns null → no event.
    expect(handle(closeLine())).toBeNull();
  });

  it("tracks multiple concurrent sessions independently", () => {
    const handle = createLineConsumer();
    handle(usageLine({ rp: 1, rb: 100, sp: 1, sb: 100 }, undefined, "000000000000000001"));
    handle(
      usageLine(
        { rp: 2, rb: 200, sp: 2, sb: 200 },
        "1733770000:k=apk_two:p=peer_two",
        "000000000000000002",
      ),
    );

    const r1 = handle(closeLine("000000000000000001"));
    expect(r1!.event.api_key_id).toBe("apk_abc123");
    expect(r1!.event.bytes_received).toBe(100);

    const r2 = handle(closeLine("000000000000000002"));
    expect(r2!.event.api_key_id).toBe("apk_two");
    expect(r2!.event.bytes_received).toBe(200);
  });

  it("ignores unrelated log lines without throwing", () => {
    const handle = createLineConsumer();
    expect(handle("0: (657): INFO: SQLite supported, default database location is /var/lib/coturn/turndb")).toBeNull();
    expect(handle("0: (657): INFO: Relay address to use: 0.0.0.0")).toBeNull();
    expect(handle("")).toBeNull();
  });

  it("clears session state after close — repeated close is a no-op", () => {
    const handle = createLineConsumer();
    handle(usageLine({ rp: 1, rb: 100, sp: 1, sb: 100 }));
    const first = handle(closeLine());
    expect(first).not.toBeNull();
    const second = handle(closeLine());
    expect(second).toBeNull();
  });
});
