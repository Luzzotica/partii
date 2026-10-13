import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerApi } from "./api";
import type { IceEnv } from "./ice";
import { allowed, type LimitEnv } from "./limits";
import { EDGE_USAGE, usage } from "./usage";
export { Session } from "./session";
export { Room } from "./room";
export { Usage } from "./usage";
export { Limiter } from "./limits";
import type { Session } from "./session";
import type { Room } from "./room";
import type { Usage } from "./usage";

export interface Env extends IceEnv, LimitEnv {
  SESSION: DurableObjectNamespace<Session>;
  ROOM: DurableObjectNamespace<Room>;
  USAGE: DurableObjectNamespace<Usage>;
  /** Where usage alerts are posted (a secret: Slack or Discord webhook). Unset: Workers Logs only. */
  ALERT_WEBHOOK_URL?: string;
  ALERT_SESSIONS?: string;
  ALERT_ROOMS?: string;
  ALERT_LIMITED?: string;
  ALERT_RELAY_DROPPED?: string;
  PARTII_ENV: string;
  KEY_SECRET: string;
  /** "on": the player content (UGC) routes are served. */
  UGC?: string;
  /** 32 bytes, base64url: encrypts per-game secrets (secrets.ts). */
  SECRETS_KEY?: string;
  GRACE_MS?: string;
  DB: D1Database;
  FILES?: R2Bucket;
  FILES_KV?: KVNamespace;
  ADMIN_TOKEN?: string;
  PLAYER_TOKEN_SECRET: string;
  ALLOW_FAKE_LOGIN?: string;
  ALLOW_FAKE_STORE?: string;
  EMAIL_MODE?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  STORE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** R2's S3 API, for signed direct uploads (builds). Unset: uploads go through the Worker. */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string;
  R2_BUCKET?: string;
  APPLE_CLIENT_IDS?: string;
  GOOGLE_CLIENT_IDS?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  STEAM_WEBAPI_KEY?: string;
  STEAM_APP_ID?: string;
  APPSTORE_ISSUER_ID?: string;
  APPSTORE_KEY_ID?: string;
  APPSTORE_PRIVATE_KEY?: string;
  APPSTORE_BUNDLE_ID?: string;
  PLAY_SERVICE_ACCOUNT?: string;
  PLAY_PACKAGE_NAME?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Web apps (store, controller) call the API from other origins; auth is by
// key and token headers, never cookies, so open CORS is safe.
app.use("/v1/*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "x-partii-key", "x-partii-dry-run"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));

// The persistent session socket (docs/PROTOCOL.md).
app.get("/v1/connect", async (c) => {
  const conn = c.req.query("conn") ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(conn)) return c.json({ ok: false, error: { code: "bad_request", message: "conn must be 16–64 chars of [A-Za-z0-9_-]" } }, 400);
  if (c.req.header("upgrade") !== "websocket") return c.json({ ok: false, error: { code: "bad_request", message: "expected a websocket upgrade" } }, 426);
  if (!(await allowed(c.env, "connect", c.req.header("cf-connecting-ip") ?? ""))) {
    // No key has been seen yet, so the hit is counted edge-wide.
    c.executionCtx.waitUntil(usage(c.env, EDGE_USAGE).hit(EDGE_USAGE, "connect").catch(() => {}));
    return c.json({ ok: false, error: { code: "rate_limited", message: "too many connections from this network; try again in a minute" } }, 429);
  }
  const stub = c.env.SESSION.get(c.env.SESSION.idFromName(conn));
  return stub.fetch(c.req.raw);
});

registerApi(app);

export default app;
