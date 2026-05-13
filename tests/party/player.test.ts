import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockAdmin, makeRequest, makeParams, json } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { PATCH, OPTIONS } from "@/app/api/party/sessions/[sessionId]/players/[playerId]/route";

const SESSION_ID = "session-abc";
const PLAYER_ID = "player-uuid-1";
const BASE = `http://localhost:3000/api/party/sessions/${SESSION_ID}/players/${PLAYER_ID}`;
const PARAMS = { sessionId: SESSION_ID, playerId: PLAYER_ID };

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

describe("OPTIONS /api/party/sessions/[sessionId]/players/[playerId]", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("PATCH /api/party/sessions/[sessionId]/players/[playerId]", () => {
  it("updates player status to connected with valid secret", async () => {
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: PLAYER_ID, player_secret: "valid-secret", session_id: SESSION_ID },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        ...freshBuilder(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });

    const req = makeRequest("PATCH", BASE, { player_secret: "valid-secret", status: "connected" });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("updates player metadata", async () => {
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: PLAYER_ID, player_secret: "sec", session_id: SESSION_ID },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        ...freshBuilder(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });

    const req = makeRequest("PATCH", BASE, {
      player_secret: "sec",
      metadata: { team: "red", character: "wizard" },
    });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(200);
  });

  it("returns 403 with wrong player_secret", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({
        data: { id: PLAYER_ID, player_secret: "real-secret", session_id: SESSION_ID },
        error: null,
      }),
    });

    const req = makeRequest("PATCH", BASE, { player_secret: "wrong", status: "connected" });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(403);
  });

  it("returns 400 when player_secret is missing", async () => {
    const req = makeRequest("PATCH", BASE, { status: "connected" });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when player is not in the session", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });

    const req = makeRequest("PATCH", BASE, { player_secret: "any" });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(404);
  });

  it("only allows valid status values (ignores invalid ones)", async () => {
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: PLAYER_ID, player_secret: "sec", session_id: SESSION_ID },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        ...freshBuilder(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });

    // "hacked" is not a valid status — should be silently ignored
    const req = makeRequest("PATCH", BASE, { player_secret: "sec", status: "hacked" });
    const res = await PATCH(req, { params: makeParams(PARAMS) });
    // Should still succeed (just update last_seen_at)
    expect(res.status).toBe(200);
  });
});
