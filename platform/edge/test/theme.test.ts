import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const E = env as any;

async function api(method: string, path: string, o: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(path.startsWith("http") ? path : `https://edge${path}`, { method, headers, body: o.bytes ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, json: type.includes("json") ? ((await res.json()) as any) : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `theme${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const game = `t-${project}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 0, platforms: ["macos"] } });
  return { dev, game };
}

const woff2 = () => new Uint8Array([...new TextEncoder().encode("wOF2"), ...crypto.getRandomValues(new Uint8Array(60))]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...crypto.getRandomValues(new Uint8Array(40))]);

describe("game themes", () => {
  it("files first, then a theme naming them; anyone reads it with URLs", async () => {
    const s = await setup();
    expect((await api("GET", `/v1/games/${s.game}/theme`)).json).toMatchObject({ ok: true, theme: null });
    const font = woff2();
    const up = await api("PUT", `/v1/games/${s.game}/theme/uploads/heading.woff2`, { token: s.dev, bytes: font });
    expect(up.json.file).toMatchObject({ name: "heading.woff2", type: "font/woff2", size: font.byteLength });
    await api("PUT", `/v1/games/${s.game}/theme/uploads/logo.png`, { token: s.dev, bytes: png() });
    const theme = {
      name: "Tankii",
      colors: { background: "#EFE6D4", surface: "#E3D6BD", ink: "#3A2F1F", border: "#8B6F47", primary: "#4F8EF7", primary_lip: "#2F64C4", primary_ink: "#ffffff" },
      fonts: { heading: "heading.woff2", body: "Trebuchet MS, sans-serif" },
      radius: 12,
      border: 3,
      lip: 4,
      caps: true,
      letter_spacing: 0.08,
      logo: "logo.png",
    };
    const set = await api("PUT", `/v1/games/${s.game}/theme`, { token: s.dev, body: theme });
    expect(set.status).toBe(200);
    const got = await api("GET", `/v1/games/${s.game}/theme`);
    expect(got.headers.get("access-control-allow-origin")).toBe("*");
    expect(got.json.theme).toMatchObject({ name: "Tankii", radius: 12, caps: true, fonts: { body: "Trebuchet MS, sans-serif" } });
    const fontUrl = got.json.theme.fonts.heading.file as string;
    expect(fontUrl).toMatch(/\/v1\/games\/.+\/theme\/files\/[0-9a-f]{64}$/);
    const file = await api("GET", fontUrl);
    expect(file.headers.get("content-type")).toBe("font/woff2");
    expect(file.headers.get("cache-control")).toContain("immutable");
    expect(file.bytes).toEqual(font);
    expect((await api("GET", got.json.theme.logo)).headers.get("content-type")).toBe("image/png");
  });

  it("refuses what isn't safe to put on a page", async () => {
    const s = await setup();
    const set = (body: unknown) => api("PUT", `/v1/games/${s.game}/theme`, { token: s.dev, body });
    expect((await set({ colors: { background: "red; background:url(x)" } })).status).toBe(400);
    expect((await set({ colors: { nope: "#fff" } })).status).toBe(400);
    expect((await set({ fonts: { body: "x;}body{display:none" } })).status).toBe(400);
    expect((await set({ logo: "missing.png" })).json.error.message).toContain("isn't an uploaded");
    expect((await set({ radius: 400 })).status).toBe(400);
    expect((await set({ script: "x" })).status).toBe(400);
    // Files: allowed names and real content only (no SVG, no HTML posing as an image).
    const put = (name: string, bytes: Uint8Array) => api("PUT", `/v1/games/${s.game}/theme/uploads/${name}`, { token: s.dev, bytes });
    expect((await put("x.svg", new TextEncoder().encode("<svg/>"))).status).toBe(400);
    expect((await put("x.png", new TextEncoder().encode("<html><script>"))).status).toBe(400);
    expect((await put("x.png", woff2())).status).toBe(400);
    expect((await put("big.png", new Uint8Array(2 * 1024 * 1024).fill(1))).status).toBe(400);
    // Only the game's developer changes it.
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("PUT", `/v1/games/${s.game}/theme`, { token: stranger, body: { radius: 1 } })).status).toBe(404);
    expect((await api("PUT", `/v1/games/${s.game}/theme`, { body: { radius: 1 } })).status).toBe(401);
    expect((await api("GET", `/v1/games/no-such-game/theme`)).status).toBe(404);
  });

  it("replacing a file changes its URL; files in use can't be deleted; delete clears everything", async () => {
    const s = await setup();
    const a = (await api("PUT", `/v1/games/${s.game}/theme/uploads/bg.webp`, { token: s.dev, bytes: new Uint8Array([...new TextEncoder().encode("RIFF\0\0\0\0WEBP"), 1, 2, 3]) })).json.file;
    await api("PUT", `/v1/games/${s.game}/theme`, { token: s.dev, body: { background_image: "bg.webp" } });
    const b = (await api("PUT", `/v1/games/${s.game}/theme/uploads/bg.webp`, { token: s.dev, bytes: new Uint8Array([...new TextEncoder().encode("RIFF\0\0\0\0WEBP"), 4, 5, 6]) })).json.file;
    expect(b.url).not.toBe(a.url);
    expect((await api("GET", a.url)).status).toBe(404);
    expect((await api("GET", `/v1/games/${s.game}/theme`)).json.theme.background_image).toBe(b.url);
    expect((await api("DELETE", `/v1/games/${s.game}/theme/uploads/bg.webp`, { token: s.dev })).status).toBe(400);
    expect((await api("DELETE", `/v1/games/${s.game}/theme`, { token: s.dev })).json.deleted).toBe(true);
    expect((await api("GET", `/v1/games/${s.game}/theme`)).json.theme).toBeNull();
    expect((await api("GET", b.url)).status).toBe(404);
    expect(await E.FILES?.get?.(`themes/${s.game}/theme.json`)).toBeFalsy();
  });
});
