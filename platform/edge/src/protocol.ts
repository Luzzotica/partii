// Shared shapes for the live protocol (docs/PROTOCOL.md).

export const PROTOCOL_VERSION = 1;
export const RELAY_FRAME = 0x01;
export const BROADCAST = 0xffff;
export const MAX_RELAY_BYTES = 64 * 1024;
export const DEFAULT_MAX_MEMBERS = 8;
export const MAX_MEMBERS = 32;
export const GRACE_MS = 20_000;
export const BUFFER_LIMIT = 512;
/** A room made ahead of time lives this long unclaimed. */
export const RESERVATION_MS = 30 * 60_000;

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
  constructor(public code: ErrCode, message: string) {
    super(message);
  }
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
