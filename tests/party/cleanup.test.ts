import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminMock, mockRpc } from "./helpers/mockAdmin";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());

import { GET } from "@/app/api/party/cleanup/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/party/cleanup", () => {
  it("calls cleanup_party_data RPC and returns ok", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("cleanup_party_data");
  });

  it("returns 500 when the RPC fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "pg error" } });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("pg error");
  });
});
