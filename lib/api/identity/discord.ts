import type { ProviderResult } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Discord — OAuth2 authorization-code verification.
//
// Web games (and Discord Activities) hand us the authorization `code`; we
// exchange it server-side (code exchange is inherently safe from the
// token-substitution attack) and read the stable snowflake id from /users/@me.
// BYO config: the project's Discord application client id + secret; Discord
// itself enforces the registered redirect-URI match.
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyDiscord(
  code: string | undefined,
  redirectUri: string | undefined,
  clientId: string | null | undefined,
  clientSecret: string | null | undefined,
): Promise<ProviderResult> {
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "Discord not configured for this project (client id/secret)" };
  }
  if (!code || !redirectUri) return { ok: false, reason: "code and redirect_uri required" };

  let access: string;
  try {
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
    if (!res.ok || !data.access_token) {
      return { ok: false, reason: `Discord code exchange failed: ${data.error_description ?? data.error ?? res.status}` };
    }
    access = data.access_token;
  } catch (err) {
    return { ok: false, reason: `Discord token exchange error: ${(err as Error).message}` };
  }

  try {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(8_000),
    });
    const user = (await res.json()) as { id?: string; username?: string; global_name?: string };
    if (!res.ok || !user.id) return { ok: false, reason: "Discord /users/@me failed" };
    return { ok: true, subject: user.id, displayName: user.global_name ?? user.username };
  } catch (err) {
    return { ok: false, reason: `Discord identity fetch error: ${(err as Error).message}` };
  }
}
