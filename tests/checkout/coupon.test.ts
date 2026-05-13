import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setupAdminMock,
  setupSupabaseServerMock,
  setupStripeClientMock,
  mockGetUser,
  mockStripe,
  stageSingle,
  resetAllMocks,
  makeRequest,
  makeParams,
  json,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());
vi.mock("@/lib/supabase/server", () => setupSupabaseServerMock());
vi.mock("@/lib/stripe/client", () => setupStripeClientMock());

import { POST } from "@/app/api/checkout/offers/[slug]/coupon/route";

const URL_BASE = "http://localhost:3000/api/checkout/offers/test-offer/coupon";

beforeEach(() => {
  resetAllMocks();
});

function user() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "u@test" } } });
}

const offerRow = {
  id: "offer-1",
  slug: "test-offer",
  price_cents: 2500,
  currency: "usd",
  is_published: true,
  stripe_product_id: "prod_123",
};

const intentBase = {
  id: "pi_1",
  amount: 2500,
  currency: "usd",
  metadata: {
    user_id: "user-1",
    offer_id: "offer-1",
    original_amount: "2500",
  },
};

function call(body: unknown) {
  return POST(makeRequest("POST", URL_BASE, body), { params: makeParams({ slug: "test-offer" }) });
}

describe("POST /api/checkout/offers/[slug]/coupon — auth & validation", () => {
  it("rejects unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await call({ payment_intent_id: "pi_1", code: "X" });
    expect(res.status).toBe(401);
  });

  it("rejects when payment_intent_id missing", async () => {
    user();
    const res = await call({ code: "X" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when offer is unpublished", async () => {
    user();
    stageSingle({ data: { ...offerRow, is_published: false }, error: null });
    const res = await call({ payment_intent_id: "pi_1", code: "X" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when PI metadata user_id does not match", async () => {
    user();
    stageSingle({ data: offerRow, error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      ...intentBase,
      metadata: { ...intentBase.metadata, user_id: "someone-else" },
    });
    const res = await call({ payment_intent_id: "pi_1", code: "X" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when PI offer_id does not match", async () => {
    user();
    stageSingle({ data: offerRow, error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      ...intentBase,
      metadata: { ...intentBase.metadata, offer_id: "another-offer" },
    });
    const res = await call({ payment_intent_id: "pi_1", code: "X" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/checkout/offers/[slug]/coupon — apply", () => {
  beforeEach(() => {
    user();
    stageSingle({ data: offerRow, error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue(intentBase);
    mockStripe.paymentIntents.update.mockImplementation(async (_id: string, params: { amount: number }) => ({
      id: "pi_1",
      amount: params.amount,
      currency: "usd",
    }));
  });

  it("applies a percent_off coupon", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "promo_1",
          code: "SAVE10",
          active: true,
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
          promotion: {
            type: "coupon",
            coupon: {
              id: "coupon_1",
              valid: true,
              percent_off: 10,
              amount_off: null,
              currency: null,
              applies_to: null,
            },
          },
        },
      ],
    });

    const res = await call({ payment_intent_id: "pi_1", code: "SAVE10" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      amount: 2250,
      original_amount: 2500,
      discount_label: "10% off",
      code: "SAVE10",
    });
    expect(mockStripe.paymentIntents.update).toHaveBeenCalledWith(
      "pi_1",
      expect.objectContaining({
        amount: 2250,
        metadata: expect.objectContaining({
          promotion_code_id: "promo_1",
          coupon_id: "coupon_1",
          coupon_code: "SAVE10",
          discount_label: "10% off",
          user_id: "user-1",
          offer_id: "offer-1",
        }),
      })
    );
  });

  it("applies an amount_off coupon", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "promo_2",
          code: "FIVEOFF",
          promotion: {
            type: "coupon",
            coupon: {
              id: "c2",
              valid: true,
              percent_off: null,
              amount_off: 500,
              currency: "usd",
              applies_to: null,
            },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "FIVEOFF" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.amount).toBe(2000);
  });

  it("rejects an amount_off coupon in a different currency", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p3",
          code: "EUROFF",
          promotion: {
            type: "coupon",
            coupon: {
              id: "c3",
              valid: true,
              percent_off: null,
              amount_off: 500,
              currency: "eur",
              applies_to: null,
            },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "EUROFF" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/currency/i);
  });

  it("rejects an unknown code", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({ data: [] });
    const res = await call({ payment_intent_id: "pi_1", code: "NOPE" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid coupon", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p4",
          code: "DEAD",
          promotion: {
            type: "coupon",
            coupon: { id: "c4", valid: false, percent_off: 50, amount_off: null, currency: null, applies_to: null },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "DEAD" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired promotion code", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p5",
          code: "OLD",
          promotion: {
            type: "coupon",
            coupon: { id: "c5", valid: true, percent_off: 10, amount_off: null, currency: null, applies_to: null },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: Math.floor(Date.now() / 1000) - 60,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "OLD" });
    expect(res.status).toBe(400);
  });

  it("rejects when redemption limit is reached", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p6",
          code: "FULL",
          promotion: {
            type: "coupon",
            coupon: { id: "c6", valid: true, percent_off: 10, amount_off: null, currency: null, applies_to: null },
          },
          times_redeemed: 5,
          max_redemptions: 5,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "FULL" });
    expect(res.status).toBe(400);
  });

  it("enforces applies_to.products against the offer's product", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p7",
          code: "WRONGPROD",
          promotion: {
            type: "coupon",
            coupon: {
              id: "c7",
              valid: true,
              percent_off: 10,
              amount_off: null,
              currency: null,
              applies_to: { products: ["prod_other"] },
            },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "WRONGPROD" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/not valid for this offer/i);
  });

  it("rejects 100%-off codes", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p8",
          code: "FREE",
          promotion: {
            type: "coupon",
            coupon: { id: "c8", valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: null },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "FREE" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/100% off/i);
  });

  it("rejects discounted total below the per-currency minimum", async () => {
    // $25 offer with $24.90 off → $0.10 left, below USD minimum of $0.50
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "p9",
          code: "TOOMUCH",
          promotion: {
            type: "coupon",
            coupon: { id: "c9", valid: true, percent_off: null, amount_off: 2490, currency: "usd", applies_to: null },
          },
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
        },
      ],
    });
    const res = await call({ payment_intent_id: "pi_1", code: "TOOMUCH" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/minimum/i);
  });
});

describe("POST /api/checkout/offers/[slug]/coupon — remove", () => {
  beforeEach(() => {
    user();
    stageSingle({ data: offerRow, error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      ...intentBase,
      amount: 2250,
      metadata: {
        ...intentBase.metadata,
        promotion_code_id: "promo_1",
        coupon_id: "coupon_1",
        coupon_code: "SAVE10",
        discount_label: "10% off",
      },
    });
    mockStripe.paymentIntents.update.mockImplementation(async (_id: string, params: { amount: number; metadata: Record<string, string> }) => ({
      id: "pi_1",
      amount: params.amount,
      currency: "usd",
    }));
  });

  it("reverts to the original amount when code is null", async () => {
    const res = await call({ payment_intent_id: "pi_1", code: null });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      amount: 2500,
      original_amount: 2500,
      discount_label: null,
      code: null,
    });
    expect(mockStripe.paymentIntents.update).toHaveBeenCalledWith(
      "pi_1",
      expect.objectContaining({
        amount: 2500,
        metadata: expect.objectContaining({
          promotion_code_id: "",
          coupon_id: "",
          coupon_code: "",
          discount_label: "",
          user_id: "user-1",
          offer_id: "offer-1",
        }),
      })
    );
  });

  it("treats blank/whitespace code as removal", async () => {
    const res = await call({ payment_intent_id: "pi_1", code: "   " });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.amount).toBe(2500);
  });
});
