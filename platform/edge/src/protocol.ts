// Shared shapes for the live protocol (docs/PROTOCOL.md).

export const PROTOCOL_VERSION = 1;
export const RELAY_FRAME = 0x01;
/** Several datagrams for one member in one frame (opaque to the edge). */
export const RELAY_BUNDLE = 0x02;
export const BROADCAST = 0xffff;
export const MAX_RELAY_BYTES = 64 * 1024;
export const DEFAULT_MAX_MEMBERS = 8;
export const MAX_MEMBERS = 32;
export const GRACE_MS = 20_000;
export const BUFFER_LIMIT = 512;
/** A room made ahead of time lives this long unclaimed. */
export const RESERVATION_MS = 30 * 60_000;
/** A room whose host timed out keeps its code this long for that host to reclaim. */
export const RECLAIM_MS = 10 * 60_000;

/** Hex sha-256 (reclaim tokens are stored only as hashes). */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ErrCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "full"
  | "closed"
  | "not_joinable"
  | "already_in_room"
  | "not_in_room"
  | "not_host"
  | "rate_limited"
  | "internal";

export class ProtoError extends Error {
  /** Extra fields for the `err` frame, e.g. `retry_after_ms` on `rate_limited`. */
  constructor(public code: ErrCode, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/** Per-kind room settings: whether that kind may join now, and how many of it fit. */
export interface KindRule {
  joinable?: boolean;
  max?: number;
}
export const MAX_KIND_RULES = 8;

/** Merge a client's `kinds` patch into the current rules (a kind set to null drops its rule). */
export function mergeKinds(cur: Record<string, KindRule> | undefined, patch: unknown): Record<string, KindRule> | undefined {
  if (patch === undefined) return cur;
  if (patch === null) return undefined;
  if (typeof patch !== "object" || Array.isArray(patch)) throw new ProtoError("bad_request", "kinds must be an object like {\"game\": {\"joinable\": false}, \"phone\": {\"max\": 16}}");
  const out: Record<string, KindRule> = { ...(cur ?? {}) };
  for (const [kind, v] of Object.entries(patch as Record<string, unknown>)) {
    const k = kind.slice(0, 16);
    if (v === null) {
      delete out[k];
      continue;
    }
    if (typeof v !== "object" || Array.isArray(v)) throw new ProtoError("bad_request", `kinds.${k} must be an object or null`);
    const r = v as Record<string, unknown>;
    const rule: KindRule = {};
    if (typeof r.joinable === "boolean") rule.joinable = r.joinable;
    if (typeof r.max === "number" && Number.isFinite(r.max)) rule.max = Math.min(Math.max(Math.floor(r.max), 0), MAX_MEMBERS);
    out[k] = rule;
  }
  if (Object.keys(out).length > MAX_KIND_RULES) throw new ProtoError("bad_request", `at most ${MAX_KIND_RULES} kinds`);
  return Object.keys(out).length ? out : undefined;
}

export interface Member {
  mid: number;
  kind: string;
  name: string;
  meta: unknown;
  status: "active" | "suspended";
}

/** The room as a member sees it (no session names). */
export interface RoomView {
  code: string;
  game: string;
  host: number;
  you: number;
  joinable: boolean;
  max_members: number;
  /** Per-kind rules, when the host set any. */
  kinds?: Record<string, KindRule>;
  meta: unknown;
  members: Member[];
}

/** What the Room tells a session so it can reach the other members. */
export interface Joined {
  room: RoomView;
  conns: Record<number, string>;
}

/** Room codes: unambiguous capitals (no I or O). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newCode(len = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim().toUpperCase();
  return /^[A-Z]{4,8}$/.test(c) ? c : null;
}

export const str = (v: unknown, max = 64): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
