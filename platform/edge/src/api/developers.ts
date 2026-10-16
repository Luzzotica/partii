// Developers, their tokens, projects, publishable keys and connection timings.

import { signKey } from "../keys";
import { EDGE_USAGE, usage } from "../usage";
import { allowed } from "../limits";
import { ApiError, bad, forgetKey, now, ownProject, randomId, randomSlug, sha256hex } from "./core";
import { sendEmail } from "./players";
import type { Handlers } from "./index";

const PROJECT_ID = /^[a-z0-9]{1,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What a developer who signed up themselves may do before an operator trusts them. */
export const NEW_DEVELOPER_LIMITS = { projects: 5, games: 20, paid: false };

/** Email codes for developers share the players' table under a "dev:" key. */
const codeKey = (email: string) => `dev:${email}`;

async function newDevToken(env: Parameters<Handlers[string]>[0]["env"], developerId: string, name: string) {
  const token = `pd_${randomId(24)}`;
  const id = randomSlug(10);
  await env.DB.prepare("INSERT INTO dev_tokens (id, developer_id, token_hash, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, developerId, await sha256hex(token), name, now())
    .run();
  return { id, name, created_at: now(), token };
}

export const developerHandlers: Handlers = {
  // ── Sign-up and sign-in: an email code, then a developer token ──

  async developersLoginStart({ env, req, body }) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw bad("a valid email is required");
    const ip = req.headers.get("cf-connecting-ip") ?? "";
    if (!(await allowed(env, "login", `devlogin:${ip}`)) || !(await allowed(env, "login", `devlogin:${email}`))) {
      throw new ApiError(429, "rate_limited", "too many codes asked for", "wait a minute, then ask again");
    }
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await env.DB.prepare("INSERT INTO email_codes (email, code_hash, expires_at, tries) VALUES (?, ?, ?, 0) ON CONFLICT DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0")
      .bind(codeKey(email), await sha256hex(`${codeKey(email)}:${code}`), now() + 10 * 60_000)
      .run();
    const known = await env.DB.prepare("SELECT 1 FROM developers WHERE email = ?").bind(email).first();
    if (await sendEmail(env, email, code, "developer")) return { sent: true, new_developer: !known, hint: "ask the person for the 6-digit code in their email, then: partii login --email <email> --code <code>" };
    if (env.PARTII_ENV === "production") throw new ApiError(503, "email_unavailable", "codes can't be emailed right now", "try again shortly");
    return { sent: false, code, new_developer: !known, note: "no mail provider here; the code is returned instead" };
  },

  async developersLogin({ env, body }) {
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    const k = codeKey(email);
    const row = await env.DB.prepare("SELECT code_hash, expires_at, tries FROM email_codes WHERE email = ?").bind(k).first<{ code_hash: string; expires_at: number; tries: number }>();
    if (!row || row.expires_at < now()) throw new ApiError(401, "code_expired", "no current code for this email", "ask for one: partii login --email <email>");
    if (row.tries >= 5) throw new ApiError(429, "rate_limited", "too many wrong codes", "ask for a new code");
    if ((await sha256hex(`${k}:${code}`)) !== row.code_hash) {
      await env.DB.prepare("UPDATE email_codes SET tries = tries + 1 WHERE email = ?").bind(k).run();
      throw new ApiError(401, "bad_code", "that code is not right", "check the latest email");
    }
    await env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(k).run();
    let dev = await env.DB.prepare("SELECT id, email, name, trusted, created_at FROM developers WHERE email = ?").bind(email).first<{ id: string; email: string; name: string; trusted: number; created_at: number }>();
    const created = !dev;
    if (!dev) {
      dev = { id: randomSlug(12), email, name: String(body.name ?? "").slice(0, 80), trusted: 0, created_at: now() };
      await env.DB.prepare("INSERT INTO developers (id, email, name, created_at, trusted, signup) VALUES (?, ?, ?, ?, 0, 'email')").bind(dev.id, dev.email, dev.name, dev.created_at).run();
    }
    const token = await newDevToken(env, dev.id, String(body.token_name ?? "cli").slice(0, 60));
    return {
      developer: { id: dev.id, email: dev.email, name: dev.name, trusted: !!dev.trusted },
      token: token.token,
      token_id: token.id,
      created,
      next: created ? "make a project: partii projects put <id> --name <name>; then partii games put <game> --project <id>" : "you're signed in",
    };
  },

  async adminCreateDeveloper({ env, body }) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw bad("a valid email is required");
    let dev = await env.DB.prepare("SELECT id, email, name, created_at FROM developers WHERE email = ?").bind(email).first();
    if (!dev) {
      dev = { id: randomSlug(12), email, name: String(body.name ?? ""), created_at: now() };
      await env.DB.prepare("INSERT INTO developers (id, email, name, created_at) VALUES (?, ?, ?, ?)").bind(dev.id, dev.email, dev.name, dev.created_at).run();
    }
    if (body.trusted !== false) await env.DB.prepare("UPDATE developers SET trusted = 1 WHERE id = ?").bind(dev.id).run();
    const token = await newDevToken(env, dev.id as string, "first");
    return { developer: dev, token: token.token };
  },

  async adminUsage({ env, query }) {
    const ids = query.project
      ? [query.project]
      : [EDGE_USAGE, ...(await env.DB.prepare("SELECT id FROM projects ORDER BY id").all<{ id: string }>()).results.map((r) => r.id)];
    // One project's Usage object can fail transiently ("internal error; reference = …"); retry it once,
    // then report that project's error rather than failing the whole report.
    const view = async (id: string) => {
      try {
        return await usage(env, id).view();
      } catch {
        return await usage(env, id).view();
      }
    };
    const projects = await Promise.all(
      ids.map(async (id) => {
        try {
          return { ...(await view(id)), project: id };
        } catch (e) {
          return { project: id, error: String((e as Error)?.message ?? e) };
        }
      }),
    );
    return { projects };
  },

  async me({ caller }) {
    return { developer: caller.developer, limits: caller.developer!.trusted ? null : NEW_DEVELOPER_LIMITS };
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
    if (!existing && !caller.developer!.trusted) {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE developer_id = ?").bind(caller.developer!.id).first<{ n: number }>();
      if ((n?.n ?? 0) >= NEW_DEVELOPER_LIMITS.projects) throw new ApiError(403, "limit", `new developers can have ${NEW_DEVELOPER_LIMITS.projects} projects`, "ask partii for more (support@sterlinglong.me)");
    }
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
