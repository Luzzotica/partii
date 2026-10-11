// Relay credentials for WebRTC. Cloudflare TURN in staging and production;
// a static coturn in local and torture runs. The rule: a client gets a full
// relay list (always including TURN over TLS on 443) or an empty list with
// `relay: "ws"`, never a STUN-only list (docs/PROTOCOL.md).

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceGrant {
  ice_servers: IceServer[];
  ice_expires_at: number;
  relay: "turn" | "ws";
}

export interface IceEnv {
  TURN_MODE?: string;
  CF_TURN_KEY_ID?: string;
  CF_TURN_API_TOKEN?: string;
  TURN_STATIC_URLS?: string;
  TURN_STATIC_USERNAME?: string;
  TURN_STATIC_CREDENTIAL?: string;
}

const TTL_S = 4 * 3600;

const wsOnly = (now: number): IceGrant => ({ ice_servers: [], ice_expires_at: now + 15 * 60_000, relay: "ws" });

export async function mintIce(env: IceEnv, now = Date.now(), fetcher: typeof fetch = fetch): Promise<IceGrant> {
  const mode = env.TURN_MODE ?? "none";
  if (mode === "static") {
    const urls = (env.TURN_STATIC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return wsOnly(now);
    return {
      ice_servers: [{ urls, username: env.TURN_STATIC_USERNAME, credential: env.TURN_STATIC_CREDENTIAL }],
      ice_expires_at: now + TTL_S * 1000,
      relay: "turn",
    };
  }
  if (mode === "cloudflare" && env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
    try {
      const res = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: TTL_S }),
      });
      if (!res.ok) return wsOnly(now);
      const body = (await res.json()) as { iceServers?: IceServer[] | IceServer };
      const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
      const servers = list.map((s) => ({ ...s, urls: Array.isArray(s.urls) ? s.urls : [s.urls as unknown as string] }));
      const hasTls443 = servers.some((s) => s.urls.some((u) => u.startsWith("turns:") && u.includes(":443")));
      if (!hasTls443) return wsOnly(now);
      return { ice_servers: servers, ice_expires_at: now + TTL_S * 1000, relay: "turn" };
    } catch {
      return wsOnly(now);
    }
  }
  return wsOnly(now);
}
