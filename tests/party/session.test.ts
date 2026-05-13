import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockSingle, mockAdmin, makeRequest, makeParams, json } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { GET, PATCH, OPTIONS } from "@/app/api/party/sessions/[sessionId]/route";

const SESSION_ID = "session-uuid-1234";
const BASE = `http://localhost:3000/api/party/sessions/${SESSION_ID}`;

function freshBuilder() {
  return {
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
    maybeSingle: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.from.mockReturnValue(freshBuilder());
});

describe("OPTIONS /api/party/sessions/[sessionId]", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("GET /api/party/sessions/[sessionId]", () => {
  it("returns session with players", async () => {
    const sessionData = {
      id: SESSION_ID,
      join_code: "ABC123",
      game_id: "my-game",
      status: "waiting",
      max_players: 8,
      metadata: {},
      created_at: "2026-04-19T00:00:00Z",
      expires_at: "2026-04-19T02:00:00Z",
    };
    const playersData = [
      { id: "player-1", display_name: "Alice", slot: 1, status: "joined", joined_at: "2026-04-19T00:01:00Z", metadata: {} },
    ];

    // First from() call: session select
    // Second from() call: players select
    mockAdmin.from
      .mockReturnValueOnce({ ...freshBuilder(), single: vi.fn().mockResolvedValue({ data: sessionData, error: null }) })
      .mockReturnValueOnce({
        ...freshBuilder(),
        order: vi.fn().mockReturnValue(Promise.resolve({ data: playersData, error: null })),
      });

    const req = makeRequest("GET", BASE);
    const res = await GET(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.join_code).toBe("ABC123");
    expect(body.player_count).toBe(1);
    expect(body.players).toHaveLength(1);
    expect(body.players[0].player_id).toBe("player-1");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 404 when session not found", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });

    const req = makeRequest("GET", BASE);
    const res = await GET(req, { params: makeParams({ sessionId: SESSION_ID }) });

    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toBeTruthy();
  });
});

describe("PATCH /api/party/sessions/[sessionId]", () => {
  it("ends a session with valid host_secret", async () => {
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: SESSION_ID, host_secret: "correct-secret", status: "active" },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        ...freshBuilder(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });

    const req = makeRequest("PATCH", BASE, { host_secret: "correct-secret", status: "ended" });
    const res = await PATCH(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns 403 with wrong host_secret", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({
        data: { id: SESSION_ID, host_secret: "real-secret", status: "active" },
        error: null,
      }),
    });

    const req = makeRequest("PATCH", BASE, { host_secret: "wrong-secret", status: "ended" });
    const res = await PATCH(req, { params: makeParams({ sessionId: SESSION_ID }) });

    expect(res.status).toBe(403);
  });

  it("returns 400 when host_secret is missing", async () => {
    const req = makeRequest("PATCH", BASE, { status: "ended" });
    const res = await PATCH(req, { params: makeParams({ sessionId: SESSION_ID }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when session not found", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });

    const req = makeRequest("PATCH", BASE, { host_secret: "any" });
    const res = await PATCH(req, { params: makeParams({ sessionId: SESSION_ID }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with no updates when only host_secret provided", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({
        data: { id: SESSION_ID, host_secret: "sec", status: "waiting" },
        error: null,
      }),
    });

    const req = makeRequest("PATCH", BASE, { host_secret: "sec" });
    const res = await PATCH(req, { params: makeParams({ sessionId: SESSION_ID }) });
    expect(res.status).toBe(200);
  });
});
