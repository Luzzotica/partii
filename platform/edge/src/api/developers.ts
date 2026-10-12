// Developers, their tokens, projects, publishable keys and connection timings.

import { signKey } from "../keys";
import { EDGE_USAGE, usage } from "../usage";
import { bad, forgetKey, now, ownProject, randomId, randomSlug, sha256hex } from "./core";
import type { Handlers } from "./index";

const PROJECT_ID = /^[a-z0-9]{1,32}$/;

async function newDevToken(env: Parameters<Handlers[string]>[0]["env"], developerId: string, name: string) {
  const token = `pd_${randomId(24)}`;
  const id = randomSlug(10);
  await env.DB.prepare("INSERT INTO dev_tokens (id, developer_id, token_hash, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, developerId, await sha256hex(token), name, now())
    .run();
  return { id, name, created_at: now(), token };
}

export const developerHandlers: Handlers = {
  async adminCreateDeveloper({ env, body }) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw bad("a valid email is required");
    let dev = await env.DB.prepare("SELECT id, email, name, created_at FROM developers WHERE email = ?").bind(email).first();
    if (!dev) {
      dev = { id: randomSlug(12), email, name: String(body.name ?? ""), created_at: now() };
      await env.DB.prepare("INSERT INTO developers (id, email, name, created_at) VALUES (?, ?, ?, ?)").bind(dev.id, dev.email, dev.name, dev.created_at).run();
    }
    const token = await newDevToken(env, dev.id as string, "first");
    return { developer: dev, token: token.token };
  },

  async adminUsage({ env, query }) {
    const ids = query.project
      ? [query.project]
      : [EDGE_USAGE, ...(await env.DB.prepare("SELECT id FROM projects ORDER BY id").all<{ id: string }>()).results.map((r) => r.id)];
    const projects = await Promise.all(ids.map(async (id) => ({ ...(await usage(env, id).view()), project: id })));
    return { projects };
  },

  async me({ caller }) {
    return { developer: caller.developer };
  },

  async tokensList({ env, caller }) {
    const r = await env.DB.prepare("SELECT id, name, created_at, revoked_at FROM dev_tokens WHERE developer_id = ? ORDER BY created_at").bind(caller.developer!.id).all();
    return { tokens: r.results.map((t) => ({ ...t, current: t.id === caller.tokenId })) };
  },

  async tokensCreate({ env, caller, body }) {
    return { token: await newDevToken(env, caller.developer!.id, String(body.name ?? "")) };
  },

  async tokensRevoke({ env, caller, params }) {
    const r = await env.DB.prepare("UPDATE dev_tokens SET revoked_at = ? WHERE id = ? AND developer_id = ? AND revoked_at IS NULL").bind(now(), params.token_id, caller.developer!.id).run();
    return { revoked: r.meta.changes > 0 };
  },

  async projectsList({ env, caller }) {
    const r = await env.DB.prepare("SELECT id, name, plan, created_at FROM projects WHERE developer_id = ? ORDER BY created_at").bind(caller.developer!.id).all();
    return { projects: r.results };
  },

  async projectsPut({ env, caller, params, body, dryRun }) {
    const id = params.project;
    if (!PROJECT_ID.test(id)) throw bad("project ids are 1–32 lowercase letters and digits");
    const existing = await env.DB.prepare("SELECT id, developer_id, name, plan, created_at FROM projects WHERE id = ?").bind(id).first<{ developer_id: string; name: string }>();
    if (existing && existing.developer_id !== caller.developer!.id) throw bad(`project id ${id} is taken`, "pick another id");
    const name = body.name !== undefined ? String(body.name) : existing?.name ?? id;
    const project = { id, name, plan: "free", created_at: existing ? (existing as unknown as { created_at: number }).created_at : now() };
    if (dryRun) return { dry_run: true, project, created: !existing };
    if (existing) await env.DB.prepare("UPDATE projects SET name = ? WHERE id = ?").bind(name, id).run();
    else await env.DB.prepare("INSERT INTO projects (id, developer_id, name, plan, created_at) VALUES (?, ?, ?, 'free', ?)").bind(id, caller.developer!.id, name, project.created_at).run();
    return { project, created: !existing };
  },

  async projectsGet({ env, caller, params }) {
    return { project: await ownProject(env, caller, params.project) };
  },

  async keysList({ env, caller, params }) {
    await ownProject(env, caller, params.project);
    const r = await env.DB.prepare("SELECT key_id, name, created_at, revoked_at FROM keys WHERE project_id = ? ORDER BY created_at").bind(params.project).all<{ key_id: string }>();
    const keys = await Promise.all(r.results.map(async (k) => ({ project: params.project, ...k, key: await signKey(env.KEY_SECRET, params.project, k.key_id) })));
    return { keys };
  },

  async keysCreate({ env, caller, params, body, dryRun }) {
    await ownProject(env, caller, params.project);
    const keyId = body.key_id !== undefined ? String(body.key_id) : randomSlug(8);
    if (!PROJECT_ID.test(keyId)) throw bad("key ids are 1–32 lowercase letters and digits");
    const key = await signKey(env.KEY_SECRET, params.project, keyId);
    if (dryRun) return { dry_run: true, key: { project: params.project, key_id: keyId } };
    await env.DB.prepare("INSERT INTO keys (project_id, key_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name, revoked_at = NULL")
      .bind(params.project, keyId, String(body.name ?? ""), now())
      .run();
    return { key: { project: params.project, key_id: keyId, name: String(body.name ?? ""), key, revoked_at: null } };
  },

  async keysRevoke({ env, caller, params, dryRun }) {
    await ownProject(env, caller, params.project);
    if (dryRun) return { dry_run: true };
    const r = await env.DB.prepare("UPDATE keys SET revoked_at = ? WHERE project_id = ? AND key_id = ? AND revoked_at IS NULL").bind(now(), params.project, params.key_id).run();
    forgetKey(params.project, params.key_id);
    return { revoked: r.meta.changes > 0 };
  },

  async timingsList({ env, caller, params, query }) {
    await ownProject(env, caller, params.project);
    const limit = Math.min(Math.max(Number(query.limit ?? 200), 1), 2000);
    const r = await env.DB.prepare("SELECT metrics, created_at FROM timings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").bind(params.project, limit).all<{ metrics: string; created_at: number }>();
    const timings = r.results.map((t) => ({ ...JSON.parse(t.metrics), at: t.created_at }));
    const pct = (k: string, p: number) => {
      const v = timings.map((t) => t[k]).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
      return v.length ? v[Math.round((v.length - 1) * p)] : null;
    };
    const paths: Record<string, number> = {};
    for (const t of timings) if (typeof t.path === "string") paths[t.path] = (paths[t.path] ?? 0) + 1;
    return {
      timings,
      summary: {
        count: timings.length,
        create_ms: { p50: pct("create_ms", 0.5), p95: pct("create_ms", 0.95) },
        join_ms: { p50: pct("join_ms", 0.5), p95: pct("join_ms", 0.95) },
        connect_ms: { p50: pct("connect_ms", 0.5), p95: pct("connect_ms", 0.95) },
        paths,
      },
    };
  },
};
