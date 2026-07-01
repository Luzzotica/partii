// Origin allowlist matching for the token exchange.
//
// Browsers send an Origin header that in-page JS cannot forge, so locking a
// project's web key to its own origins genuinely blocks reuse on other sites.
// Native clients (Steam/Tauri, mobile) don't send a trustworthy Origin — they
// authenticate via platform attestation instead, so a request with NO Origin
// header is not gated here (the attestation step handles it).

function hostMatches(reqHost: string, pattern: string): boolean {
  if (pattern === reqHost) return true;
  // Leading-wildcard host: "*.sterlinglong.me" matches "play.sterlinglong.me"
  // (and the apex "sterlinglong.me").
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return reqHost === base || reqHost.endsWith(`.${base}`);
  }
  return false;
}

/**
 * @param origin   The request's Origin header (may be null for native clients).
 * @param allowed  project.allowed_origins — entries like
 *                 "https://play.sterlinglong.me" or "https://*.sterlinglong.me".
 *                 Empty array = no Origin restriction.
 * @returns true if the request is permitted on Origin grounds.
 */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  // No restriction configured, or a native client with no Origin → defer to
  // the attestation step.
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return true;

  let req: URL;
  try {
    req = new URL(origin);
  } catch {
    return false;
  }

  return allowed.some((entry) => {
    let pat: URL;
    try {
      pat = new URL(entry.replace("*.", "wildcard.")); // parse-safe placeholder
    } catch {
      return false;
    }
    if (pat.protocol !== req.protocol) return false;
    const pattern = entry.includes("://") ? entry.split("://")[1] : entry;
    const patternHost = pattern.split("/")[0];
    return hostMatches(req.host, patternHost);
  });
}

/** Is this Origin a local-dev origin (localhost / 127.0.0.1 / *.local)? */
export function isLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h.endsWith(".local") ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
