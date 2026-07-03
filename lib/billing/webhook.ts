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

type ProjectPatch = Record<string, unknown>;

/** Pure event → patch mapping (unit-tested without Stripe). Returns null when
 *  the event isn't a Lobbii subscription event. */
export function lobbiiPatchForEvent(event: Stripe.Event): { projectId: string; patch: ProjectPatch } | null {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.metadata?.product !== "lobbii" || !s.metadata.project_id || s.mode !== "subscription") return null;
    return {
      projectId: s.metadata.project_id,
      patch: {
        ...planPatch("pro"),
        stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
        stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
      },
    };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.product !== "lobbii" || !sub.metadata.project_id) return null;
    const active = event.type !== "customer.subscription.deleted"
      && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due");
    return {
      projectId: sub.metadata.project_id,
      patch: active
        ? { ...planPatch("pro"), stripe_subscription_id: sub.id }
        : { ...planPatch("free"), stripe_subscription_id: null },
    };
  }
  return null;
}

export async function applyLobbiiSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const mapped = lobbiiPatchForEvent(event);
  if (!mapped) return;
  // Lazy client: this module is imported by unit tests without Supabase env.
  const admin = createAdminClient();
  const { error } = await admin.from("projects").update(mapped.patch).eq("id", mapped.projectId);
  if (error) console.error("[billing] failed to apply subscription event:", event.type, error.message);
}
