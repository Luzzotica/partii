import { Hono } from "hono";
import type { IceEnv } from "./ice";
export { Session } from "./session";
export { Room } from "./room";
import type { Session } from "./session";
import type { Room } from "./room";

export interface Env extends IceEnv {
  SESSION: DurableObjectNamespace<Session>;
  ROOM: DurableObjectNamespace<Room>;
  PARTII_ENV: string;
  KEY_SECRET: string;
  GRACE_MS?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.PARTII_ENV }));

// The persistent session socket (docs/PROTOCOL.md).
app.get("/v1/connect", async (c) => {
  const conn = c.req.query("conn") ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(conn)) return c.json({ ok: false, error: { code: "bad_request", message: "conn must be 16–64 chars of [A-Za-z0-9_-]" } }, 400);
  if (c.req.header("upgrade") !== "websocket") return c.json({ ok: false, error: { code: "bad_request", message: "expected a websocket upgrade" } }, 426);
  const stub = c.env.SESSION.get(c.env.SESSION.idFromName(conn));
  return stub.fetch(c.req.raw);
});

export default app;
