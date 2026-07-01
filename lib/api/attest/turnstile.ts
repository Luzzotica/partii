import type { AttestResult } from "./index";

// Cloudflare Turnstile (free, privacy-friendly CAPTCHA-alternative). The web
// game renders an invisible/managed widget; the client sends the resulting
// token here, and we verify it against Cloudflare's siteverify endpoint.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string | undefined,
  ip: string | null,
): Promise<AttestResult> {
  const secret = process.env.TURNSTILE_SECRET;

  // No secret configured: allow locally (so dev isn't blocked) but fail closed
  // in production — we don't want to silently disable the check on deploy.
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, reason: "TURNSTILE_SECRET not configured" };
  }
  if (!token) return { ok: false, reason: "missing Turnstile token" };

  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);

  let data: { success?: boolean; "error-codes"?: string[] };
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, reason: `Turnstile verify failed: ${(e as Error).message}` };
  }

  if (data.success) return { ok: true };
  return { ok: false, reason: `Turnstile rejected: ${(data["error-codes"] ?? []).join(",")}` };
}
