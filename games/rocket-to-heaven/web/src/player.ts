import { useSyncExternalStore } from "react";
import { api, deviceId, forgetToken, partiiErrorMessage, rememberToken, savedToken } from "./partii";

export interface PartiiPlayer {
  id: string;
  display_name: string;
  /** True until the guest links an email (or another provider). */
  guest: boolean;
}

interface RawPlayer {
  id: string;
  display_name: string;
  providers?: string[];
}

let player: PartiiPlayer | null = null;
let status: "idle" | "ready" | "error" = "idle";
let error: string | null = null;
let signingIn: Promise<PartiiPlayer> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function asPlayer(raw: RawPlayer): PartiiPlayer {
  const providers = raw.providers ?? [];
  return {
    id: raw.id,
    display_name: raw.display_name,
    guest: providers.length === 0 || providers.every((provider) => provider === "device"),
  };
}

function setPlayer(next: PartiiPlayer): void {
  player = next;
  status = "ready";
  error = null;
  emit();
}

export function getPlayer(): PartiiPlayer | null {
  return player;
}

export function getPlayerStatus(): "idle" | "ready" | "error" {
  return status;
}

export function getPlayerError(): string | null {
  return error;
}

export function subscribePlayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePartiiPlayer(): PartiiPlayer | null {
  return useSyncExternalStore(subscribePlayer, getPlayer, () => null);
}

export function usePlayerStatus(): "idle" | "ready" | "error" {
  return useSyncExternalStore(subscribePlayer, getPlayerStatus, () => "idle");
}

/** One guest per browser. A saved token is reused; a rejected token starts a new guest. */
export function ensureGuest(): Promise<PartiiPlayer> {
  if (player && status === "ready") return Promise.resolve(player);
  if (!signingIn) {
    signingIn = signIn().finally(() => {
      signingIn = null;
    });
  }
  return signingIn;
}

async function signIn(): Promise<PartiiPlayer> {
  const existing = savedToken();
  if (existing) {
    api.setPlayerToken(existing);
    try {
      const me = (await api.playersMe()) as { player: RawPlayer };
      setPlayer(asPlayer(me.player));
      return player!;
    } catch {
      forgetToken();
    }
  }

  try {
    const created = (await api.playersGuest({
      device_id: deviceId(),
      display_name: "Player",
    })) as { player: RawPlayer; player_token: string };
    rememberToken(created.player_token);
    setPlayer(asPlayer(created.player));
    return player!;
  } catch (err) {
    status = "error";
    error = partiiErrorMessage(err);
    emit();
    throw err;
  }
}

export async function renamePlayer(name: string): Promise<void> {
  const displayName = name.trim().slice(0, 40);
  if (!displayName) throw new Error("Enter a name");
  await ensureGuest();
  const updated = (await api.playersUpdate({ display_name: displayName })) as { player: RawPlayer };
  setPlayer(asPlayer(updated.player));
}

export async function startEmailSignIn(email: string): Promise<{ sent: boolean; code?: string }> {
  await ensureGuest();
  return (await api.playersEmailStart({ email: email.trim() })) as { sent: boolean; code?: string };
}

export async function finishEmailSignIn(email: string, code: string): Promise<void> {
  await ensureGuest();
  const result = (await api.playersLogin({
    provider: "email",
    email: email.trim(),
    code: code.trim(),
    display_name: player?.display_name,
  })) as { player: RawPlayer; player_token: string };
  rememberToken(result.player_token);
  setPlayer(asPlayer(result.player));
}
