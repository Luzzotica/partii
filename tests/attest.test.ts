import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstile } from "@/lib/api/attest/turnstile";
import { verifySteamTicket } from "@/lib/api/attest/steam";

// BYO resolution: customer projects supply their own attestation credentials;
// the platform env values only serve first-party projects.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("verifyTurnstile credential resolution", () => {
  it("uses the PROJECT secret when provided (env ignored)", async () => {
    vi.stubEnv("TURNSTILE_SECRET", "env-secret");
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });
    const res = await verifyTurnstile("tok", null, "project-secret");
    expect(res.ok).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("secret")).toBe("project-secret");
  });

  it("falls back to the env secret when the project has none", async () => {
    vi.stubEnv("TURNSTILE_SECRET", "env-secret");
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });
    await verifyTurnstile("tok", null, null);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("secret")).toBe("env-secret");
  });

  it("fails closed in production when nothing is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET", "");
    const res = await verifyTurnstile("tok", null, null);
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifySteamTicket credential resolution", () => {
  it("uses the PROJECT key + app id when provided", async () => {
    vi.stubEnv("STEAM_WEBAPI_PUBLISHER_KEY", "env-key");
    vi.stubEnv("STEAM_APP_ID", "111");
    fetchMock.mockResolvedValue({
      json: async () => ({ response: { params: { result: "OK", steamid: "765" } } }),
    });
    const res = await verifySteamTicket("ticket", undefined, "proj-key", "222");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.playerId).toBe("steam:765");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("key=proj-key");
    expect(url).toContain("appid=222");
  });

  it("falls back to env creds when the project has none", async () => {
    vi.stubEnv("STEAM_WEBAPI_PUBLISHER_KEY", "env-key");
    vi.stubEnv("STEAM_APP_ID", "111");
    fetchMock.mockResolvedValue({
      json: async () => ({ response: { params: { result: "OK", steamid: "765" } } }),
    });
    await verifySteamTicket("ticket", undefined, null, null);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("key=env-key");
    expect(url).toContain("appid=111");
  });

  it("fails closed in production when nothing is configured", async () => {
    vi.stubEnv("STEAM_WEBAPI_PUBLISHER_KEY", "");
    vi.stubEnv("STEAM_APP_ID", "");
    const res = await verifySteamTicket("ticket", undefined, null, null);
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
