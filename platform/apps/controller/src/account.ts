// Optional sign-in on the phone (email code). A signed-in phone tells the
// game who is playing (`hello.player`) and hands over the player's `profile`
// save for that game (name, look), so their own tank shows up on the big
// screen. The token stays on the phone; the game never sees it.

export type Player = { id: string; name: string; token: string };

const KEY = "partii.player";

export function storedPlayer(): Player | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return p && p.token && p.id ? p : null;
  } catch {
    return null;
  }
}

export function signOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

async function call(edge: string, key: string, method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(edge.replace(/\/$/, "") + path, {
    method,
    headers: { "content-type": "application/json", "x-partii-key": key, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
}

/** Ask for a code. Without a mail provider (dev, staging) the code comes back. */
export async function startEmail(edge: string, key: string, email: string): Promise<{ ok: boolean; code?: string; error?: string }> {
  const r = await call(edge, key, "POST", "/v1/players/email/start", { email });
  return r.ok ? { ok: true, code: r.code } : { ok: false, error: r.error?.message ?? "could not send a code" };
}

export async function finishEmail(edge: string, key: string, email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(edge, key, "POST", "/v1/players/login", { provider: "email", email, code });
  if (!r.ok) return { ok: false, error: r.error?.message ?? "sign-in failed" };
  const p: Player = { id: r.player.id, name: r.player.display_name ?? r.player.name ?? "", token: r.player_token };
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: signed in for this page only */
  }
  return { ok: true };
}

/** The player's `profile` save for `game` (null when none or signed out). */
export async function fetchProfile(edge: string, key: string, game: string, p: Player): Promise<Record<string, unknown> | null> {
  try {
    const r = await call(edge, key, "GET", `/v1/saves/${encodeURIComponent(game)}/profile`, undefined, p.token);
    return r.ok && r.save?.data && typeof r.save.data === "object" ? r.save.data : null;
  } catch {
    return null;
  }
}
