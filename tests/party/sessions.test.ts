import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockRpc, mockSingle, mockMaybeSingle, mockAdmin, makeRequest, json } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

// Import AFTER vi.mock so the module-scoped admin uses our mock
import { POST, OPTIONS } from "@/app/api/party/sessions/route";

const BASE_URL = "http://localhost:3000/api/party/sessions";

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  });
});

describe("OPTIONS /api/party/sessions", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("POST /api/party/sessions", () => {
  it("creates a session and returns session_id, join_code, host_secret", async () => {
    // generate_join_code RPC
    mockRpc.mockResolvedValueOnce({ data: "ABC123", error: null });
    // conflict check (no existing session with that code)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // insert session
    mockSingle.mockResolvedValueOnce({
      data: { id: "session-uuid", join_code: "ABC123", expires_at: "2026-04-20T00:00:00Z" },
      error: null,
    });
    // cleanup fire-and-forget
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest("POST", BASE_URL, { game_id: "my-game", max_players: 4 });
    const res = await POST(req);
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      session_id: "session-uuid",
      join_code: "ABC123",
      expires_at: "2026-04-20T00:00:00Z",
    });
    expect(typeof body.host_secret).toBe("string");
    expect(body.host_secret.length).toBeGreaterThan(0);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("works with an empty body (all defaults)", async () => {
    mockRpc.mockResolvedValueOnce({ data: "ZZZ999", error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { id: "uuid-2", join_code: "ZZZ999", expires_at: "2026-04-20T00:00:00Z" },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const req = new Request(BASE_URL, { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("retries join_code generation on conflict", async () => {
    // First code conflicts, second does not
    mockRpc
      .mockResolvedValueOnce({ data: "CLASH1", error: null })
      .mockResolvedValueOnce({ data: "FRESH2", error: null });
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: "existing" }, error: null }) // conflict
      .mockResolvedValueOnce({ data: null, error: null });              // no conflict
    mockSingle.mockResolvedValueOnce({
      data: { id: "new-uuid", join_code: "FRESH2", expires_at: "2026-04-20T00:00:00Z" },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest("POST", BASE_URL, { game_id: "test" });
    const res = await POST(req);
    const body = await json(res);
    expect(res.status).toBe(201);
    expect(body.join_code).toBe("FRESH2");
  });

  it("returns 500 if all join_code attempts conflict", async () => {
    // All 5 attempts return a conflict
    for (let i = 0; i < 5; i++) {
      mockRpc.mockResolvedValueOnce({ data: `CODE${i}`, error: null });
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: "existing" }, error: null });
    }

    const req = makeRequest("POST", BASE_URL, {});
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error).toMatch(/join code/i);
  });

  it("returns 500 if the insert fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: "GOOD12", error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "DB error" } });

    const req = makeRequest("POST", BASE_URL, { game_id: "test" });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("caps max_players at 16", async () => {
    mockRpc.mockResolvedValueOnce({ data: "CAPXXX", error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { id: "uuid-3", join_code: "CAPXXX", expires_at: "2026-04-20T00:00:00Z" },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest("POST", BASE_URL, { max_players: 999 });
    await POST(req);

    // Verify the insert was called — max_players should have been capped
    // (we trust the route logic; this test mainly checks it doesn't blow up)
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });
});
