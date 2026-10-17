import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type Opts = { token?: string; key?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };
async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(path.startsWith("http") ? path : `https://edge${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, json: type.includes("json") ? ((await res.json()) as any) : null, res };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `dl${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).json.key.key as string;
  const game = `g-${project}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 500, platforms: ["windows", "macos"] } });
  await api("POST", `/v1/games/${game}/publish`, { token: dev });
  return { dev, key, game };
}

describe("downloads", () => {
  it("a download link names the file, works without auth for a while, and resumes; only for owners", async () => {
    const s = await setup();
    const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
    await api("POST", `/v1/games/${s.game}/builds?platform=windows&version=1.2.0&filename=tankii-1.2.0-windows.zip`, { token: s.dev, raw: bytes });
    const me = (await api("POST", "/v1/players/guest", { key: s.key, body: { device_id: `d-${uniq()}` } })).json;
    expect((await api("GET", `/v1/store/games/${s.game}/download/windows/link`, { key: s.key, token: me.player_token })).status).toBe(402);
    await api("POST", `/v1/games/${s.game}/entitlements`, { token: s.dev, body: { player: me.player.id } });
    const link = (await api("GET", `/v1/store/games/${s.game}/download/windows/link`, { key: s.key, token: me.player_token })).json;
    expect(link).toMatchObject({ filename: "tankii-1.2.0-windows.zip", version: "1.2.0", size: 100, platform: "windows" });
    const file = await SELF.fetch(link.url);
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="tankii-1.2.0-windows.zip"');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    const part = await SELF.fetch(link.url, { headers: { range: "bytes=90-" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 90-99/100");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(90));
    // A forged or edited link is refused.
    expect((await SELF.fetch(link.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A")))).status).toBe(410);
  });

  it("install instructions: partii's defaults until the game sets its own; reset goes back", async () => {
    const s = await setup();
    let ins = (await api("GET", `/v1/store/games/${s.game}/instructions`)).json.instructions;
    expect(ins.windows.custom).toBe(false);
    expect(ins.windows.markdown).toContain("Extract All");
    expect(ins.macos.markdown).toContain("{{title}}");
    const set = await api("PUT", `/v1/games/${s.game}/instructions`, { token: s.dev, body: { platform: "windows", markdown: "1. Unzip.\n2. Run **Tankii.exe**." } });
    expect(set.json).toMatchObject({ platform: "windows", custom: true });
    ins = (await api("GET", `/v1/store/games/${s.game}`)).json.instructions;
    expect(ins.windows).toEqual({ markdown: "1. Unzip.\n2. Run **Tankii.exe**.", custom: true });
    expect(ins.linux.custom).toBe(false);
    expect((await api("PUT", `/v1/games/${s.game}/instructions`, { token: s.dev, body: { platform: "dos", markdown: "x" } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${s.game}/instructions`, { token: s.dev, body: { platform: "windows" } })).status).toBe(400);
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("PUT", `/v1/games/${s.game}/instructions`, { token: stranger, body: { platform: "windows", markdown: "x" } })).status).toBe(404);
    await api("PUT", `/v1/games/${s.game}/instructions`, { token: s.dev, body: { platform: "windows", reset: true } });
    expect((await api("GET", `/v1/store/games/${s.game}/instructions`)).json.instructions.windows.custom).toBe(false);
  });
});
