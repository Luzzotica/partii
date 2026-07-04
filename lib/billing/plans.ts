import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe/client";

// ─────────────────────────────────────────────────────────────────────────────
// Lobbii billing plans.
//
// One paid plan ("pro", $5/mo) + metered relay overage. The quota columns on
// the project row are WRITTEN whenever the plan changes (webhook), so the
// existing enforcement paths (room-create quota, signal rate limit, relay cap)
// stay completely billing-unaware.
//
// Stripe objects are resolved by price lookup_key (created once by
// scripts/setup-lobbii-plans.ts) — no price ids in env.
// ─────────────────────────────────────────────────────────────────────────────

export const PRO_PRICE_LOOKUP = "lobbii_pro_monthly";
export const OVERAGE_PRICE_LOOKUP = "lobbii_relay_overage_gb";

export type PlanId = "free" | "pro";

export type PlanLimits = {
  max_rooms_per_hour: number;
  max_concurrent_rooms: number;
  max_signals_per_min: number;
  relay_included_gb: number;
  max_content_items: number;
  max_storage_bytes: number;
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    max_rooms_per_hour: 120,
    max_concurrent_rooms: 50,
    max_signals_per_min: 600,
    relay_included_gb: 5,
    max_content_items: 200,
    max_storage_bytes: 100 * 1024 * 1024, // 100 MB
  },
  pro: {
    max_rooms_per_hour: 1_200,
    max_concurrent_rooms: 500,
    max_signals_per_min: 6_000,
    relay_included_gb: 25,
    max_content_items: 10_000,
    max_storage_bytes: 5 * 1024 * 1024 * 1024, // 5 GB
  },
};

/** The user's account plan ('free' when no billing row exists). */
export async function accountPlan(admin: SupabaseClient, userId: string): Promise<PlanId> {
  const { data } = await admin
    .from("billing_accounts")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan === "pro" ? "pro" : "free";
}

export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan as PlanId) ?? "free"] ?? PLAN_LIMITS.free;
}

/** Project-row patch applied on any plan transition. */
export function planPatch(plan: PlanId): Record<string, unknown> {
  return { plan, ...PLAN_LIMITS[plan] };
}

let priceCache: Map<string, string> | null = null;

/** Resolve a Stripe price id by lookup_key (cached per instance). */
export async function priceIdByLookup(lookup: string): Promise<string> {
  if (priceCache?.has(lookup)) return priceCache.get(lookup)!;
  const stripe = getStripe();
  const prices = await stripe.prices.list({ lookup_keys: [lookup], limit: 1, active: true });
  const price = prices.data[0];
  if (!price) throw new Error(`Stripe price with lookup_key ${lookup} not found — run scripts/setup-lobbii-plans.ts`);
  priceCache ??= new Map();
  priceCache.set(lookup, price.id);
  return price.id;
}

/** Build the Checkout Session params for upgrading the ACCOUNT to pro.
 *  Pure-ish (prices injected) so tests can assert the shape without Stripe. */
export function proCheckoutParams(opts: {
  userId: string;
  userEmail?: string | null;
  proPriceId: string;
  overagePriceId: string;
  baseUrl: string;
  /** Optional: which project page to return to. */
  returnProjectId?: string;
}): Stripe.Checkout.SessionCreateParams {
  const back = opts.returnProjectId
    ? `${opts.baseUrl}/developer/projects/${opts.returnProjectId}`
    : `${opts.baseUrl}/developer`;
  return {
    mode: "subscription",
    line_items: [
      { price: opts.proPriceId, quantity: 1 },
      { price: opts.overagePriceId }, // metered: no quantity
    ],
    // metadata on BOTH the session and the subscription: the webhook reads
    // whichever object the event carries. user_id is the billing principal.
    metadata: { user_id: opts.userId, product: "lobbii" },
    subscription_data: {
      metadata: { user_id: opts.userId, product: "lobbii" },
    },
    customer_email: opts.userEmail ?? undefined,
    success_url: `${back}?upgraded=1`,
    cancel_url: back,
  };
}
