import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { PLAN_LIMITS, planLimits, planPatch, proCheckoutParams } from "@/lib/billing/plans";
import { lobbiiPlanForEvent } from "@/lib/billing/webhook";

describe("plan limits", () => {
  it("free is the fallback for unknown/null plans", () => {
    expect(planLimits(null)).toEqual(PLAN_LIMITS.free);
    expect(planLimits("nonsense")).toEqual(PLAN_LIMITS.free);
    expect(planLimits("pro")).toEqual(PLAN_LIMITS.pro);
  });

  it("planPatch writes the quota columns for the tier", () => {
    const patch = planPatch("pro");
    expect(patch.plan).toBe("pro");
    expect(patch.max_rooms_per_hour).toBe(1200);
    expect(patch.relay_included_gb).toBe(25);
  });
});

describe("pro checkout params", () => {
  const params = proCheckoutParams({
    userId: "user-1",
    userEmail: "dev@example.com",
    proPriceId: "price_pro",
    overagePriceId: "price_over",
    baseUrl: "https://example.com",
    returnProjectId: "proj-1",
  });

  it("is a subscription with flat + metered items", () => {
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_pro", quantity: 1 },
      { price: "price_over" }, // metered: no quantity
    ]);
  });

  it("carries the USER (billing principal) on session AND subscription", () => {
    expect(params.metadata?.user_id).toBe("user-1");
    expect(params.subscription_data?.metadata?.user_id).toBe("user-1");
    expect(params.metadata?.product).toBe("lobbii");
  });

  it("returns to the project page", () => {
    expect(params.success_url).toContain("/developer/projects/proj-1");
  });
});

function subEvent(type: string, sub: Partial<Stripe.Subscription>): Stripe.Event {
  return { type, data: { object: sub } } as unknown as Stripe.Event;
}

describe("webhook event → account plan", () => {
  it("checkout completion upgrades the ACCOUNT to pro with stripe ids", () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { product: "lobbii", user_id: "user-1" },
          customer: "cus_123",
          subscription: "sub_456",
        },
      },
    } as unknown as Stripe.Event;
    const mapped = lobbiiPlanForEvent(event);
    expect(mapped?.userId).toBe("user-1");
    expect(mapped?.plan).toBe("pro");
    expect(mapped?.stripeCustomerId).toBe("cus_123");
    expect(mapped?.stripeSubscriptionId).toBe("sub_456");
  });

  it("ignores non-lobbii checkouts (courses)", () => {
    const event = {
      type: "checkout.session.completed",
      data: { object: { mode: "payment", metadata: { user_id: "u", offer_id: "o" } } },
    } as unknown as Stripe.Event;
    expect(lobbiiPlanForEvent(event)).toBeNull();
  });

  it("subscription deletion downgrades the account to free", () => {
    const mapped = lobbiiPlanForEvent(
      subEvent("customer.subscription.deleted", {
        metadata: { product: "lobbii", user_id: "user-1" },
        status: "canceled",
        id: "sub_456",
      }),
    );
    expect(mapped?.plan).toBe("free");
    expect(mapped?.stripeSubscriptionId).toBeNull();
  });

  it("subscription update to unpaid downgrades; active keeps pro", () => {
    const unpaid = lobbiiPlanForEvent(
      subEvent("customer.subscription.updated", {
        metadata: { product: "lobbii", user_id: "user-1" },
        status: "unpaid",
        id: "sub_456",
      }),
    );
    expect(unpaid?.plan).toBe("free");
    const active = lobbiiPlanForEvent(
      subEvent("customer.subscription.updated", {
        metadata: { product: "lobbii", user_id: "user-1" },
        status: "active",
        id: "sub_456",
      }),
    );
    expect(active?.plan).toBe("pro");
  });

  it("ignores unrelated event types", () => {
    expect(lobbiiPlanForEvent({ type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event)).toBeNull();
  });
});
