"use client";

import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Project settings: origins allowlist, BYO attestation credentials, and the
// session-token enforcement toggle. All of this is OPTIONAL hardening — the
// copy makes clear a bare API key already works, matching the product's
// zero-config-first principle.
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectSettings = {
  id: string;
  allowed_origins: string[];
  require_session_tokens: boolean;
  steam_app_id: string | null;
  turnstile_configured: boolean;
  steam_configured: boolean;
  apple_bundle_id: string | null;
  google_web_client_id: string | null;
  discord_client_id: string | null;
  discord_configured: boolean;
};

export function ProjectSettingsManager({ initial }: { initial: ProjectSettings }) {
  const [settings, setSettings] = useState(initial);
  const [originsText, setOriginsText] = useState(initial.allowed_origins.join("\n"));
  const [turnstileSecret, setTurnstileSecret] = useState("");
  const [steamKey, setSteamKey] = useState("");
  const [steamAppId, setSteamAppId] = useState(initial.steam_app_id ?? "");
  const [appleBundleId, setAppleBundleId] = useState(initial.apple_bundle_id ?? "");
  const [googleClientId, setGoogleClientId] = useState(initial.google_web_client_id ?? "");
  const [discordClientId, setDiscordClientId] = useState(initial.discord_client_id ?? "");
  const [discordSecret, setDiscordSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, done: (p: ProjectSettings) => void) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${settings.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      done(data.project as ProjectSettings);
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveOrigins = () =>
    patch(
      { allowed_origins: originsText.split(/\n+/).map((o) => o.trim()).filter(Boolean) },
      (p) => setSettings(p),
    );

  const saveAttestation = () =>
    patch(
      {
        ...(turnstileSecret ? { turnstile_secret: turnstileSecret } : {}),
        ...(steamKey ? { steam_publisher_key: steamKey } : {}),
        steam_app_id: steamAppId,
      },
      (p) => {
        setSettings(p);
        setTurnstileSecret("");
        setSteamKey("");
      },
    );

  const toggleEnforcement = () =>
    patch({ require_session_tokens: !settings.require_session_tokens }, (p) => setSettings(p));

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Security (optional)</h2>
        <p className="text-sm text-white/60 mt-1">
          Your API key alone is a complete setup — nothing here is required to ship. These controls
          harden a launched game against key abuse; enable them one rung at a time.
        </p>
      </div>

      {/* Origins */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/80">1. Allowed browser origins</h3>
        <p className="text-xs text-white/50">
          One per line, e.g. <code className="text-white/70">https://mygame.com</code>. Empty =
          no restriction. Only affects the (optional) token exchange.
        </p>
        <textarea
          className="w-full h-20 rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
          value={originsText}
          onChange={(e) => setOriginsText(e.target.value)}
          placeholder={"https://mygame.com\nhttps://*.mygame.com"}
        />
        <button
          onClick={saveOrigins}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50"
        >
          Save origins
        </button>
      </div>

      {/* BYO attestation */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/80">2. Attestation credentials (bring your own)</h3>
        <p className="text-xs text-white/50">
          Web: create a free{" "}
          <a
            href="https://developers.cloudflare.com/turnstile/"
            target="_blank"
            rel="noreferrer"
            className="text-blue-300 hover:underline"
          >
            Cloudflare Turnstile
          </a>{" "}
          widget for <em>your</em> domains, paste its <strong>secret</strong> here, and use your
          site key in your game. Steam: your publisher Web API key + App ID from
          partner.steamgames.com. Secrets are encrypted at rest and never shown again.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="password"
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder={settings.turnstile_configured ? "Turnstile secret (configured ✓ — paste to replace)" : "Turnstile secret"}
            value={turnstileSecret}
            onChange={(e) => setTurnstileSecret(e.target.value)}
          />
          <input
            type="password"
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder={settings.steam_configured ? "Steam publisher key (configured ✓ — paste to replace)" : "Steam publisher Web API key"}
            value={steamKey}
            onChange={(e) => setSteamKey(e.target.value)}
          />
          <input
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder="Steam App ID (e.g. 4485010)"
            value={steamAppId}
            onChange={(e) => setSteamAppId(e.target.value)}
          />
        </div>
        <button
          onClick={saveAttestation}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50"
        >
          Save attestation
        </button>
      </div>

      {/* Enforcement */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/80">3. Require session tokens</h3>
        <p className="text-xs text-white/50">
          {settings.require_session_tokens
            ? "ON — raw API keys are rejected on gameplay routes; only session tokens from /api/auth/token work."
            : "OFF — raw API keys work everywhere (default). Only enable once every shipped client performs the token exchange, or you will break live players."}
        </p>
        <button
          onClick={toggleEnforcement}
          disabled={saving}
          className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${
            settings.require_session_tokens
              ? "bg-red-500/20 hover:bg-red-500/30 text-red-200"
              : "bg-white/10 hover:bg-white/20"
          }`}
        >
          {settings.require_session_tokens ? "Disable enforcement" : "Enable enforcement"}
        </button>
      </div>

      {/* Player sign-in providers */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/80">4. Player sign-in providers (optional)</h3>
        <p className="text-xs text-white/50">
          Lets players log into YOUR game via Apple, Google, or Discord (Steam uses the publisher
          key above; anonymous sign-in needs no setup at all). Configure only the platforms your
          game ships on.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder="Apple bundle id (Game Center + Sign in with Apple)"
            value={appleBundleId}
            onChange={(e) => setAppleBundleId(e.target.value)}
          />
          <input
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder="Google web OAuth client id"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
          />
          <input
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder="Discord application client id"
            value={discordClientId}
            onChange={(e) => setDiscordClientId(e.target.value)}
          />
          <input
            type="password"
            className="rounded-lg bg-black/30 border border-white/10 p-2 text-sm font-mono"
            placeholder={settings.discord_configured ? "Discord client secret (configured ✓ — paste to replace)" : "Discord client secret"}
            value={discordSecret}
            onChange={(e) => setDiscordSecret(e.target.value)}
          />
        </div>
        <button
          onClick={() =>
            patch(
              {
                apple_bundle_id: appleBundleId,
                google_web_client_id: googleClientId,
                discord_client_id: discordClientId,
                ...(discordSecret ? { discord_client_secret: discordSecret } : {}),
              },
              (p) => {
                setSettings(p);
                setDiscordSecret("");
              },
            )
          }
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50"
        >
          Save providers
        </button>
      </div>

      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </section>
  );
}
