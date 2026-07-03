import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { planPatch } from "./plans";

// ─────────────────────────────────────────────────────────────────────────────
// Lobbii subscription lifecycle → project row.
//
// The checkout session and the subscription both carry { project_id, product:
// "lobbii" } metadata, so whatever object an event delivers, we can find the
// project. Plan transitions WRITE the tier's quota columns onto the project —
// enforcement paths stay billing-unaware.
// ─────────────────────────────────────────────────────────────────────────────

/** Pure event → account-plan mapping (unit-tested without Stripe). Returns
 *  null when the event isn't a Lobbii subscription event. Plans are
 *  ACCOUNT-level: free = 1 project / 1 key; pro = unlimited. */
export function lobbiiPlanForEvent(event: Stripe.Event): {
  userId: string;
  plan: "free" | "pro";
  stripeCustomerId?: string | null;
  stripeSubscriptionId: string | null;
} | null {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.metadata?.product !== "lobbii" || !s.metadata.user_id || s.mode !== "subscription") return null;
    return {
      userId: s.metadata.user_id,
      plan: "pro",
      stripeCustomerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
      stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
    };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.product !== "lobbii" || !sub.metadata.user_id) return null;
    const active = event.type !== "customer.subscription.deleted"
      && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due");
    return {
      userId: sub.metadata.user_id,
      plan: active ? "pro" : "free",
      stripeSubscriptionId: active ? sub.id : null,
    };
  }
  return null;
}

export async function applyLobbiiSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const mapped = lobbiiPlanForEvent(event);
  if (!mapped) return;
  // Lazy client: this module is imported by unit tests without Supabase env.
  const admin = createAdminClient();
  const account: Record<string, unknown> = {
    user_id: mapped.userId,
    plan: mapped.plan,
    stripe_subscription_id: mapped.stripeSubscriptionId,
    updated_at: new Date().toISOString(),
  };
  if (mapped.stripeCustomerId !== undefined) account.stripe_customer_id = mapped.stripeCustomerId;
  const { error: accErr } = await admin
    .from("billing_accounts")
    .upsert(account, { onConflict: "user_id" });
  if (accErr) console.error("[billing] account upsert failed:", event.type, accErr.message);
  // Materialize the tier's quotas onto EVERY project the user owns — runtime
  // enforcement reads project columns and stays billing-unaware.
  const { error: projErr } = await admin
    .from("projects")
    .update(planPatch(mapped.plan))
    .eq("user_id", mapped.userId);
  if (projErr) console.error("[billing] project quota sync failed:", event.type, projErr.message);
}
