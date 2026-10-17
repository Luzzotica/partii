import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type Opts = { token?: string; body?: unknown };
async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup(publish = true) {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `notes${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const game = `g-${project}`;
  expect((await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 0, platforms: ["macos"] } })).json.ok).toBe(true);
  if (publish) await api("POST", `/v1/games/${game}/publish`, { token: dev });
  return { dev, game };
}

const MD = "## New\n\n- **Creator worlds**: share a world with a code\n- Faster loading\n\nPlus bug fixes.";

describe("patch notes", () => {
  it("publishes per version (idempotent), lists newest first, and shows on the store page", async () => {
    const { dev, game } = await setup();
    const a = await api("PUT", `/v1/games/${game}/notes/0.4.277`, { token: dev, body: { markdown: "Older notes.", date: "2026-10-16" } });
    expect(a.json).toMatchObject({ ok: true, created: true, note: { version: "0.4.277", title: "Tankii 0.4.277", date: "2026-10-16" } });
    const b = await api("PUT", `/v1/games/${game}/notes/0.4.278`, { token: dev, body: { markdown: MD } });
    expect(b.json.url).toMatch(new RegExp(`/games/${game}/updates/0.4.278$`));
    expect(b.json.index_url).toMatch(new RegExp(`/games/${game}/updates$`));
    // Again: an update, not a second post; the first publish time stays.
    const again = await api("PUT", `/v1/games/${game}/notes/0.4.278`, { token: dev, body: { markdown: `${MD}\n\nFixed a typo.`, title: "Creator worlds" } });
    expect(again.json).toMatchObject({ created: false, note: { title: "Creator worlds", published_at: b.json.note.published_at } });
    const list = (await api("GET", `/v1/store/games/${game}/notes`)).json;
    expect(list.notes.map((x: any) => x.version)).toEqual(["0.4.278", "0.4.277"]);
    expect(list.notes[0].excerpt).toBe("Creator worlds: share a world with a code · Faster loading · Plus bug fixes. · Fixed a typo.");
    expect(list.notes[0].markdown).toBeUndefined();
    const one = (await api("GET", `/v1/store/games/${game}/notes/0.4.278`)).json.note;
    expect(one.markdown).toContain("Fixed a typo.");
    expect((await api("GET", `/v1/store/games/${game}`)).json.latest_note).toMatchObject({ version: "0.4.278", title: "Creator worlds" });
    // Pages.
    const p1 = (await api("GET", `/v1/store/games/${game}/notes?limit=1`)).json;
    expect(p1.notes).toHaveLength(1);
    const p2 = (await api("GET", `/v1/store/games/${game}/notes?limit=1&before=${p1.next_before}`)).json;
    expect(p2.notes.map((x: any) => x.version)).toEqual(["0.4.277"]);
    expect(p2.next_before).toBeNull();
    // Delete.
    expect((await api("DELETE", `/v1/games/${game}/notes/0.4.277`, { token: dev })).json.deleted).toBe(true);
    expect((await api("GET", `/v1/store/games/${game}/notes/0.4.277`)).status).toBe(404);
  });

  it("only the game's developer publishes; bad versions, dates and empty notes are refused; drafts aren't public", async () => {
    const { dev, game } = await setup();
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("PUT", `/v1/games/${game}/notes/1.0`, { token: stranger, body: { markdown: "hi" } })).status).toBe(404);
    expect((await api("PUT", `/v1/games/${game}/notes/1.0`, { body: { markdown: "hi" } })).status).toBe(401);
    expect((await api("PUT", `/v1/games/${game}/notes/..%2Fx`, { token: dev, body: { markdown: "hi" } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${game}/notes/1.0`, { token: dev, body: { markdown: "  " } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${game}/notes/1.0`, { token: dev, body: { markdown: "hi", date: "17/10/2026" } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${game}/notes/1.0`, { token: dev, body: { markdown: "x".repeat(65 * 1024) } })).status).toBe(400);
    const draft = await setup(false);
    expect((await api("PUT", `/v1/games/${draft.game}/notes/1.0`, { token: draft.dev, body: { markdown: "hi" } })).json.ok).toBe(true);
    expect((await api("GET", `/v1/store/games/${draft.game}/notes`)).status).toBe(404);
  });
});
