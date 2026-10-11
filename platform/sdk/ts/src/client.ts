// The partii API for web apps: a typed method per operation (generated.ts,
// from api/openapi.yaml) over this small fetch transport. Every reply is the
// platform's JSON: `{ok: true, ...}` or `{ok: false, error: {code, message, hint}}`.

import { operations } from "./generated";

export interface Credentials {
  /** Platform API base URL. */
  base: string;
  /** Publishable key (games, the store, controllers). */
  key?: string;
  /** Signed-in player. */
  playerToken?: string;
  /** Developer token (tools only; never ship it). */
  developerToken?: string;
}

export class PartiiError extends Error {
  constructor(public code: string, message: string, public hint: string, public status: number, public body: any) {
    super(message);
  }
}

export interface Transport {
  call(method: string, path: string, auth: string, query: Record<string, unknown>, body: unknown, response: "json" | "binary"): Promise<any>;
}

export function transport(creds: () => Credentials): Transport {
  return {
    async call(method, path, auth, query, body, response) {
      const c = creds();
      const qs = Object.entries(query ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&");
      const headers: Record<string, string> = {};
      if ((auth === "key" || auth === "player") && c.key) headers["x-partii-key"] = c.key;
      if ((auth === "player" || auth === "key") && c.playerToken) headers.authorization = `Bearer ${c.playerToken}`;
      if ((auth === "developer" || auth === "admin") && c.developerToken) headers.authorization = `Bearer ${c.developerToken}`;
      let payload: BodyInit | undefined;
      if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) payload = body as BodyInit;
      else if (body !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${c.base.replace(/\/$/, "")}${path}${qs ? `?${qs}` : ""}`, { method, headers, body: payload });
      if (response === "binary" && res.ok) return res.blob();
      const json = await res.json().catch(() => ({ ok: false, error: { code: "bad_reply", message: `status ${res.status}`, hint: "" } }));
      if (!json.ok) throw new PartiiError(json.error?.code ?? "error", json.error?.message ?? "request failed", json.error?.hint ?? "", res.status, json);
      return json;
    },
  };
}

/** A client whose credentials can change (sign-in swaps the player token). */
export function createClient(creds: Credentials) {
  let current = { ...creds };
  const api = operations(transport(() => current));
  return Object.assign(api, {
    setPlayerToken(t: string | undefined) {
      current = { ...current, playerToken: t };
    },
    credentials: () => current,
  });
}

export type PartiiClient = ReturnType<typeof createClient>;
