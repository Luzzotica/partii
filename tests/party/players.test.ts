import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockRpc, mockAdmin, makeRequest, makeParams, json } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { GET, POST, OPTIONS } from "@/app/api/party/sessions/[sessionId]/players/route";

const SESSION_ID = "session-abc";
const BASE = `http://localhost:3000/api/party/sessions/${SESSION_ID}/players`;

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
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.from.mockReturnValue(freshBuilder());
});

describe("OPTIONS /api/party/sessions/[sessionId]/players", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("GET /api/party/sessions/[sessionId]/players", () => {
  it("returns a list of players", async () => {
    const players = [
      { id: "p1", display_name: "Alice", slot: 1, status: "joined", joined_at: "2026-04-19T00:01:00Z", metadata: {} },
      { id: "p2", display_name: "Bob", slot: 2, status: "connected", joined_at: "2026-04-19T00:02:00Z", metadata: {} },
    ];
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      order: vi.fn().mockResolvedValue({ data: players, error: null }),
    });

    const req = makeRequest("GET", BASE);
    const res = await GET(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(2);
    expect(body.players[0].player_id).toBe("p1");
    expect(body.players[1].display_name).toBe("Bob");
    // Secrets must never appear in the list response
    expect(body.players[0].player_secret).toBeUndefined();
  });

  it("returns an empty list when no players", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const req = makeRequest("GET", BASE);
    const res = await GET(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(0);
  });
});

describe("POST /api/party/sessions/[sessionId]/players", () => {
  it("joins a session and returns player_id, player_secret, slot", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ player_id: "player-uuid", player_slot: 1 }],
      error: null,
    });

    const req = makeRequest("POST", BASE, { display_name: "Alice" });
    const res = await POST(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body.player_id).toBe("player-uuid");
    expect(body.slot).toBe(1);
    expect(body.display_name).toBe("Alice");
    expect(typeof body.player_secret).toBe("string");
    expect(body.player_secret.length).toBeGreaterThan(0);
  });

  it("defaults display_name to 'Player' when not provided", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ player_id: "player-uuid-2", player_slot: 2 }],
      error: null,
    });

    const req = new Request(BASE, { method: "POST" });
    const res = await POST(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body.display_name).toBe("Player");
  });

  it("truncates display_name to 24 characters", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ player_id: "p3", player_slot: 3 }],
      error: null,
    });

    const req = makeRequest("POST", BASE, { display_name: "A".repeat(50) });
    const res = await POST(req, { params: makeParams({ sessionId: SESSION_ID }) });
    const body = await json(res);
    expect(body.display_name).toHaveLength(24);
  });

  it("returns 409 when session is full", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "session_full" },
    });

    const req = makeRequest("POST", BASE, { display_name: "Overflow" });
    const res = await POST(req, { params: makeParams({ sessionId: SESSION_ID }) });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toMatch(/full/i);
  });

  it("returns 404 when session does not exist or is ended", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "session_not_found" },
    });

    const req = makeRequest("POST", BASE, { display_name: "Ghost" });
    const res = await POST(req, { params: makeParams({ sessionId: SESSION_ID }) });
    expect(res.status).toBe(404);
  });
});
