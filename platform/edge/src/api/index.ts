// The HTTP API: every route in the generated table (api/openapi.yaml) is
// registered here with its auth, and dispatched to the handler of the same
// operation id. A test checks the spec and the handlers match exactly.

import type { Context, Hono } from "hono";
import type { Env } from "../index";
import { ROUTES, type Route } from "../generated/routes";
import { ApiError, asAdmin, asDeveloper, asKey, asPlayer, type Caller } from "./core";
import { developerHandlers } from "./developers";
import { gameHandlers } from "./games";
import { playerHandlers } from "./players";
import { saveHandlers } from "./saves";
import { storeHandlers } from "./store";
import { ugcHandlers } from "./ugc";
import { secretHandlers } from "./secrets";
import { steamHandlers } from "./steam";
import { themeHandlers } from "./theme";
import { webHandlers } from "./web";
import { analyticsHandlers, reportPlatformError } from "./analytics";
import { leaderboardHandlers } from "./leaderboards";
import { adminHandlers } from "./admin";

export interface Ctx {
  env: Env;
  req: Request;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, any>;
  caller: Caller;
  dryRun: boolean;
}

export type Handler = (ctx: Ctx) => Promise<Record<string, unknown> | Response>;
export type Handlers = Record<string, Handler>;

export const HANDLERS: Handlers = {
  async health({ env }) {
    return { env: env.PARTII_ENV };
  },
  ...developerHandlers,
  ...gameHandlers,
  ...playerHandlers,
  ...saveHandlers,
  ...storeHandlers,
  ...ugcHandlers,
  ...secretHandlers,
  ...steamHandlers,
  ...themeHandlers,
  ...webHandlers,
  ...analyticsHandlers,
  ...leaderboardHandlers,
  ...adminHandlers,
};

async function authorize(route: Route, env: Env, req: Request): Promise<Caller> {
  switch (route.auth) {
    case "public":
    case "stripe":
      return {};
    case "admin":
      await asAdmin(env, req, MODERATOR_OPS.has(route.op));
      return {};
    case "developer":
      return asDeveloper(env, req);
    case "key":
      return asKey(env, req);
    case "player":
      return asPlayer(env, req);
  }
}

function errorResponse(c: Context, e: unknown) {
  if (e instanceof ApiError) {
    return c.json({ ok: false, error: { code: e.code, message: e.message, hint: e.hint }, ...e.extra }, e.status as 400);
  }
  console.error(e);
  return c.json({ ok: false, error: { code: "internal", message: String(e), hint: "this is a platform bug; the request was not applied" } }, 500);
}

/** Where money changes hands: any failure here is reported, not just 5xx (a 409 "you already own it" is not a failure). */
const PURCHASE_OPS = new Set(["storeCheckout", "webhookStripe", "playersReceipt"]);

/** partii's own failures go to its dashboard (platformGame): every 5xx, and failed purchases. */
function reportFailure(c: Context, route: Route, e: unknown) {
  const api = e instanceof ApiError ? e : null;
  const status = api?.status ?? 500;
  const purchase = PURCHASE_OPS.has(route.op) && api?.code !== "owned";
  if (status < 500 && !purchase) return;
  const message = api ? `${route.op}: ${api.code}: ${api.message}` : `${route.op}: ${e instanceof Error ? e.message : String(e)}`;
  const report = reportPlatformError(c.env, {
    kind: status >= 500 ? "error" : "warning",
    message,
    backtrace: !api && e instanceof Error ? (e.stack ?? "") : "",
    context: { op: route.op, method: route.method, path: route.path, status, code: api?.code ?? "internal", purchase },
  });
  try {
    c.executionCtx.waitUntil(report);
  } catch {
    /* no execution context (tests): the report runs on its own */
  }
}

/** Player content routes, switched on per environment by the UGC var. */
const isUgc = (op: string) => /^ugc[A-Z]/.test(op) || /^adminUgc[A-Z]/.test(op);

/** Admin routes the moderator's token (MODERATOR_TOKEN) may also call: player content review only. */
const MODERATOR_OPS = new Set(["adminUgcReview", "adminUgcReviewDecide", "adminUgcBlob", "adminUgcModerate"]);

export function registerApi(app: Hono<{ Bindings: Env }>) {
  for (const route of ROUTES) {
    const handler = HANDLERS[route.op];
    if (!handler) throw new Error(`no handler for ${route.op}`);
    app.on(route.method, route.path, async (c) => {
      try {
        if (isUgc(route.op) && c.env.UGC !== "on") throw new ApiError(404, "not_available", "player content isn't available on this platform yet", "it's on staging");
        const req = c.req.raw;
        const caller = await authorize(route, c.env, req);
        let body: Record<string, any> = {};
        if (route.body === "json" && route.auth !== "stripe") {
          const text = await req.text();
          if (text.trim()) {
            try {
              body = JSON.parse(text);
            } catch {
              throw new ApiError(400, "bad_request", "the body must be JSON", "send an object, e.g. {\"name\":\"x\"}");
            }
          }
        }
        const query = c.req.query();
        const dryRun = req.headers.get("x-partii-dry-run") === "1" || query.dry_run === "1";
        const out = await handler({ env: c.env, req, params: c.req.param() as Record<string, string>, query, body, caller, dryRun });
        if (out instanceof Response) return out;
        return c.json({ ok: true, ...out });
      } catch (e) {
        reportFailure(c, route, e);
        return errorResponse(c, e);
      }
    });
  }
}
