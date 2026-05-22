import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupAdminMock, mockAdminFrom, resetAllMocks } from "../checkout/helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { POST } from "@/app/api/turn/usage/route";

const URL_BASE = "http://localhost:3000/api/turn/usage";

const mockUpsertResult = vi.fn();

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetAllMocks();
  mockUpsertResult.mockReset();
  mockUpsertResult.mockResolvedValue({ data: null, error: null, count: 1 });
  // Re-wire admin.from(...).upsert(...) — resetAllMocks clears prior impl.
  mockAdminFrom.mockImplementation(() => ({
    upsert: (rows: unknown[], opts: unknown) => mockUpsertResult(rows, opts),
  }));
  process.env.TURN_USAGE_TOKEN = "test-token-32-chars-of-randomness";
});

describe("POST /api/turn/usage", () => {
  it("rejects requests without bearer auth", async () => {
    const res = await POST(makeRequest({ events: [{}] }));
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await POST(
      makeRequest({ events: [{}] }, { Authorization: "Bearer nope" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects when TURN_USAGE_TOKEN is unset (server misconfigured)", async () => {
    delete process.env.TURN_USAGE_TOKEN;
    const res = await POST(
      makeRequest({ events: [{}] }, { Authorization: "Bearer x" }),
    );
    expect(res.status).toBe(500);
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await POST(
      makeRequest("{not json", { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects payloads without an events[] array", async () => {
    const res = await POST(
      makeRequest({ nope: 1 }, { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects oversize batches (>500 events)", async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      api_key_id: "apk_test",
      session_id: String(i),
      bytes_sent: 0,
      bytes_received: 0,
    }));
    const res = await POST(
      makeRequest({ events }, { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    expect(res.status).toBe(400);
  });

  it("drops events missing api_key_id or with negative bytes, but accepts the rest", async () => {
    const events = [
      { api_key_id: "apk_okay_8plus", session_id: "1", bytes_sent: 100, bytes_received: 200 },
      { session_id: "no-key", bytes_sent: 100, bytes_received: 200 }, // missing api_key_id
      { api_key_id: "apk_negative_one", session_id: "neg", bytes_sent: -1, bytes_received: 200 }, // negative
      { api_key_id: "shrt", session_id: "x", bytes_sent: 0, bytes_received: 0 }, // < 8 chars
    ];

    const res = await POST(
      makeRequest({ events }, { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    expect(res.status).toBe(200);
    expect(mockUpsertResult).toHaveBeenCalledTimes(1);
    const [rows, opts] = mockUpsertResult.mock.calls[0]!;
    expect(rows).toHaveLength(1);
    expect((rows as Array<{ api_key_id: string }>)[0]?.api_key_id).toBe("apk_okay_8plus");
    expect(opts).toMatchObject({ onConflict: "api_key_id,session_id" });
  });

  it("upserts on (api_key_id, session_id) — idempotent reporter retries", async () => {
    const events = [
      { api_key_id: "apk_abc12345", session_id: "sess-1", bytes_sent: 1000, bytes_received: 500 },
    ];
    await POST(
      makeRequest({ events }, { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    expect(mockUpsertResult).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          api_key_id: "apk_abc12345",
          session_id: "sess-1",
          bytes_sent: 1000,
          bytes_received: 500,
        }),
      ]),
      expect.objectContaining({ onConflict: "api_key_id,session_id" }),
    );
  });

  it("clamps non-finite numbers and floors floats", async () => {
    const events = [
      {
        api_key_id: "apk_floats",
        session_id: "f",
        bytes_sent: 1234.9,
        bytes_received: 999.1,
        packets_sent: Infinity,
        packets_received: NaN,
      },
    ];
    await POST(
      makeRequest({ events }, { Authorization: "Bearer test-token-32-chars-of-randomness" }),
    );
    const [rows] = mockUpsertResult.mock.calls[0]!;
    expect((rows as Array<{ bytes_sent: number }>)[0]).toMatchObject({
      bytes_sent: 1234,
      bytes_received: 999,
      packets_sent: 0, // Infinity → drops to 0 default
      packets_received: 0, // NaN → drops to 0 default
    });
  });

  it("propagates upsert errors as 500", async () => {
    mockUpsertResult.mockResolvedValueOnce({ data: null, error: { message: "boom" }, count: null });
    const res = await POST(
      makeRequest(
        { events: [{ api_key_id: "apk_test1234", session_id: "s", bytes_sent: 0, bytes_received: 0 }] },
        { Authorization: "Bearer test-token-32-chars-of-randomness" },
      ),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });

  it("returns ok with inserted=0 when every event was dropped during validation", async () => {
    const res = await POST(
      makeRequest(
        { events: [{ bytes_sent: 1 } /* no api_key_id */] },
        { Authorization: "Bearer test-token-32-chars-of-randomness" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(0);
    expect(mockUpsertResult).not.toHaveBeenCalled();
  });
});
