import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockAdmin, mockSingle, makeRequest, makeParams, json } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { GET, POST, OPTIONS } from "@/app/api/party/sessions/[sessionId]/signals/route";

const SESSION_ID = "session-sig-test";
const BASE = `http://localhost:3000/api/party/sessions/${SESSION_ID}/signals`;
const PARAMS = { sessionId: SESSION_ID };

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

describe("OPTIONS /api/party/sessions/[sessionId]/signals", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ─── GET (poll) ───────────────────────────────────────────────────────────────

describe("GET /api/party/sessions/[sessionId]/signals", () => {
  it("returns signals for a recipient since a cursor", async () => {
    const signals = [
      { id: 5, sender_id: "host", signal_type: "offer", payload: { type: "offer", sdp: "v=0..." }, created_at: "2026-04-19T00:00:01Z" },
      { id: 6, sender_id: "host", signal_type: "ice_candidate", payload: { candidate: "..." }, created_at: "2026-04-19T00:00:02Z" },
    ];
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      limit: vi.fn().mockResolvedValue({ data: signals, error: null }),
    });

    const url = `${BASE}?recipient_id=player-abc&since_id=4&limit=20`;
    const req = makeRequest("GET", url);
    const res = await GET(req, { params: makeParams(PARAMS) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.signals).toHaveLength(2);
    expect(body.signals[0].signal_id).toBe(5);
    expect(body.signals[0].signal_type).toBe("offer");
    expect(body.next_since_id).toBe(6);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns empty signals and same next_since_id when no new rows", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const url = `${BASE}?recipient_id=host&since_id=99`;
    const req = makeRequest("GET", url);
    const res = await GET(req, { params: makeParams(PARAMS) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.signals).toHaveLength(0);
    expect(body.next_since_id).toBe(99); // unchanged
  });

  it("returns 400 when recipient_id is missing", async () => {
    const req = makeRequest("GET", BASE);
    const res = await GET(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toMatch(/recipient_id/i);
  });

  it("caps limit at 50", async () => {
    const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      limit: limitMock,
    });

    const url = `${BASE}?recipient_id=host&limit=999`;
    const req = makeRequest("GET", url);
    await GET(req, { params: makeParams(PARAMS) });

    expect(limitMock).toHaveBeenCalledWith(50);
  });
});

// ─── POST (send signal) ───────────────────────────────────────────────────────

describe("POST /api/party/sessions/[sessionId]/signals — host sender", () => {
  it("stores an offer signal from the host", async () => {
    // Verify host secret
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: SESSION_ID, host_secret: "host-sec" },
          error: null,
        }),
      })
      // Insert signal
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
      });

    const req = makeRequest("POST", BASE, {
      host_secret: "host-sec",
      recipient_id: "player-uuid",
      signal_type: "offer",
      payload: { type: "offer", sdp: "v=0..." },
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body.signal_id).toBe(42);
  });

  it("returns 403 with wrong host_secret", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({
        data: { id: SESSION_ID, host_secret: "correct" },
        error: null,
      }),
    });

    const req = makeRequest("POST", BASE, {
      host_secret: "wrong",
      recipient_id: "player-uuid",
      signal_type: "offer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when session not found", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });

    const req = makeRequest("POST", BASE, {
      host_secret: "any",
      recipient_id: "p",
      signal_type: "offer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/party/sessions/[sessionId]/signals — controller sender", () => {
  it("stores an answer signal from a controller", async () => {
    mockAdmin.from
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({
          data: { id: "player-uuid", player_secret: "player-sec" },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        ...freshBuilder(),
        single: vi.fn().mockResolvedValue({ data: { id: 99 }, error: null }),
      });

    const req = makeRequest("POST", BASE, {
      player_secret: "player-sec",
      sender_player_id: "player-uuid",
      recipient_id: "host",
      signal_type: "answer",
      payload: { type: "answer", sdp: "v=0..." },
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body.signal_id).toBe(99);
  });

  it("returns 400 when sender_player_id is missing with player_secret", async () => {
    const req = makeRequest("POST", BASE, {
      player_secret: "sec",
      recipient_id: "host",
      signal_type: "answer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 403 with wrong player_secret", async () => {
    mockAdmin.from.mockReturnValueOnce({
      ...freshBuilder(),
      single: vi.fn().mockResolvedValue({
        data: { id: "player-uuid", player_secret: "correct" },
        error: null,
      }),
    });

    const req = makeRequest("POST", BASE, {
      player_secret: "wrong",
      sender_player_id: "player-uuid",
      recipient_id: "host",
      signal_type: "answer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/party/sessions/[sessionId]/signals — validation", () => {
  it("returns 400 when both host_secret and player_secret are supplied", async () => {
    const req = makeRequest("POST", BASE, {
      host_secret: "h",
      player_secret: "p",
      sender_player_id: "uuid",
      recipient_id: "host",
      signal_type: "offer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither secret is supplied", async () => {
    const req = makeRequest("POST", BASE, {
      recipient_id: "host",
      signal_type: "offer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid signal_type", async () => {
    const req = makeRequest("POST", BASE, {
      host_secret: "h",
      recipient_id: "host",
      signal_type: "invalid_type",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when payload is missing", async () => {
    const req = makeRequest("POST", BASE, {
      host_secret: "h",
      recipient_id: "host",
      signal_type: "offer",
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when recipient_id is missing", async () => {
    const req = makeRequest("POST", BASE, {
      host_secret: "h",
      signal_type: "offer",
      payload: {},
    });
    const res = await POST(req, { params: makeParams(PARAMS) });
    expect(res.status).toBe(400);
  });
});
