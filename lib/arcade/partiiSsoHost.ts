// Host-side Partii arcade SSO helper for iframe embeds.
// Prefer partii:* wire types; dual-accept ready pings from legacy clients.

export const PARTII_MSG = {
  ready: "partii:ready",
  auth: "partii:auth",
  signout: "partii:signout",
} as const;

const READY_ALIASES = new Set(["partii:ready", "arcadii:ready"]);

/**
 * Listen for a game iframe's ready ping and deliver the Partii session token.
 * Returns an unsubscribe function.
 */
export function bindPartiiSsoHost(opts: {
  iframe: HTMLIFrameElement;
  gameOrigin: string;
  getAccessToken: () => string | null | undefined;
}): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== opts.gameOrigin) return;
    const type = (e.data as { type?: string } | null)?.type;
    if (!type || !READY_ALIASES.has(type)) return;
    const token = opts.getAccessToken();
    if (!token || !opts.iframe.contentWindow) return;
    opts.iframe.contentWindow.postMessage(
      { type: PARTII_MSG.auth, token },
      opts.gameOrigin,
    );
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Tell an embedded game the host user signed out. */
export function partiiSsoSignOut(iframe: HTMLIFrameElement, gameOrigin: string): void {
  iframe.contentWindow?.postMessage({ type: PARTII_MSG.signout }, gameOrigin);
}
