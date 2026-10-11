import { Hono } from "hono";
export { Session } from "./session";
export { Room } from "./room";

export interface Env {
  SESSION: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
  PARTII_ENV: string;
}

const app = new Hono<{ Bindings: Env }>();
app.get("/health", (c) => c.json({ ok: true, env: c.env.PARTII_ENV }));

export default app;
