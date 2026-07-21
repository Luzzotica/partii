import type { BalanceDocument, GameFlags } from "./types";
import { DEFAULT_FLAGS } from "./types";
import { contentSha256 } from "./canonical";
import seed from "./balance-v1.default.json";

export const DEFAULT_BALANCE = seed as BalanceDocument;
export const DEFAULT_BALANCE_ID = DEFAULT_BALANCE.id;
export const DEFAULT_BALANCE_SHA256 = contentSha256(DEFAULT_BALANCE);

export function defaultFlags(): GameFlags {
  return { ...DEFAULT_FLAGS };
}
