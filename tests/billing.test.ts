import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { PLAN_LIMITS, planLimits, planPatch, proCheckoutParams } from "@/lib/billing/plans";
import { lobbiiPatchForEvent } from "@/lib/billing/webhook";

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
    projectId: "proj-1",
    userId: "user-1",
    userEmail: "dev@example.com",
    proPriceId: "price_pro",
    overagePriceId: "price_over",
    baseUrl: "https://example.com",
  });

  it("is a subscription with flat + metered items", () => {
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_pro", quantity: 1 },
      { price: "price_over" }, // metered: no quantity
    ]);
  });

  it("carries project metadata on session AND subscription", () => {
    expect(params.metadata?.project_id).toBe("proj-1");
    expect(params.subscription_data?.metadata?.project_id).toBe("proj-1");
    expect(params.metadata?.product).toBe("lobbii");
  });

  it("returns to the project page", () => {
    expect(params.success_url).toContain("/developer/projects/proj-1");
  });
});

function subEvent(type: string, sub: Partial<Stripe.Subscription>): Stripe.Event {
  return { type, data: { object: sub } } as unknown as Stripe.Event;
}

describe("webhook event → project patch", () => {
  it("checkout completion upgrades to pro with stripe ids", () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { product: "lobbii", project_id: "proj-1" },
          customer: "cus_123",
          subscription: "sub_456",
        },
      },
    } as unknown as Stripe.Event;
    const mapped = lobbiiPatchForEvent(event);
    expect(mapped?.projectId).toBe("proj-1");
    expect(mapped?.patch.plan).toBe("pro");
    expect(mapped?.patch.stripe_customer_id).toBe("cus_123");
    expect(mapped?.patch.stripe_subscription_id).toBe("sub_456");
    expect(mapped?.patch.relay_included_gb).toBe(25);
  });

  it("ignores non-lobbii checkouts (courses)", () => {
    const event = {
      type: "checkout.session.completed",
      data: { object: { mode: "payment", metadata: { user_id: "u", offer_id: "o" } } },
    } as unknown as Stripe.Event;
    expect(lobbiiPatchForEvent(event)).toBeNull();
  });

  it("subscription deletion downgrades to free limits", () => {
    const mapped = lobbiiPatchForEvent(
      subEvent("customer.subscription.deleted", {
        metadata: { product: "lobbii", project_id: "proj-1" },
        status: "canceled",
        id: "sub_456",
      }),
    );
    expect(mapped?.patch.plan).toBe("free");
    expect(mapped?.patch.relay_included_gb).toBe(5);
    expect(mapped?.patch.stripe_subscription_id).toBeNull();
  });

  it("subscription update to unpaid downgrades; active keeps pro", () => {
    const unpaid = lobbiiPatchForEvent(
      subEvent("customer.subscription.updated", {
        metadata: { product: "lobbii", project_id: "proj-1" },
        status: "unpaid",
        id: "sub_456",
      }),
    );
    expect(unpaid?.patch.plan).toBe("free");
    const active = lobbiiPatchForEvent(
      subEvent("customer.subscription.updated", {
        metadata: { product: "lobbii", project_id: "proj-1" },
        status: "active",
        id: "sub_456",
      }),
    );
    expect(active?.patch.plan).toBe("pro");
  });

  it("ignores unrelated event types", () => {
    expect(lobbiiPatchForEvent({ type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event)).toBeNull();
  });
});
