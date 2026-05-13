import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setupAdminMock,
  setupStripeClientMock,
  setupAdminGuardMock,
  mockAdminFrom,
  mockStripe,
  resetAllMocks,
  makeRequest,
  makeParams,
  asyncIter,
  json,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());
vi.mock("@/lib/stripe/client", () => setupStripeClientMock());
vi.mock("@/lib/api/adminGuard", () => setupAdminGuardMock());

import { GET, POST } from "@/app/api/admin/coupons/route";
import { DELETE } from "@/app/api/admin/coupons/[code]/route";

const URL_BASE = "http://localhost:3000/api/admin/coupons";

beforeEach(() => {
  resetAllMocks();
});

describe("GET /api/admin/coupons", () => {
  it("returns only Stripe promotion codes whose coupon was created here", async () => {
    mockStripe.promotionCodes.list.mockReturnValue(
      asyncIter([
        {
          id: "promo_ours",
          code: "OURS",
          active: true,
          times_redeemed: 1,
          max_redemptions: null,
          expires_at: null,
          created: 1700000000,
          promotion: {
            type: "coupon",
            coupon: {
              id: "c1",
              valid: true,
              percent_off: 25,
              amount_off: null,
              currency: null,
              metadata: { source: "hexii", offer_id: "offer-1" },
            },
          },
        },
        {
          id: "promo_other",
          code: "FOREIGN",
          active: true,
          times_redeemed: 0,
          max_redemptions: null,
          expires_at: null,
          created: 1700000000,
          promotion: {
            type: "coupon",
            coupon: {
              id: "c2",
              valid: true,
              percent_off: 10,
              amount_off: null,
              currency: null,
              metadata: { source: "other-app" },
            },
          },
        },
      ])
    );
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offers") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ id: "offer-1", name: "Pro Bundle" }], error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await json<{ coupons: Array<Record<string, unknown>> }>(res);
    expect(body.coupons).toHaveLength(1);
    expect(body.coupons[0]).toMatchObject({
      id: "promo_ours",
      code: "OURS",
      percent_off: 25,
      offer_id: "offer-1",
      offer_name: "Pro Bundle",
      times_redeemed: 1,
    });
  });
});

describe("POST /api/admin/coupons — validation", () => {
  it("rejects missing code", async () => {
    const res = await POST(makeRequest("POST", URL_BASE, { discount_type: "percent", percent_off: 10 }));
    expect(res.status).toBe(400);
  });

  it("rejects bad characters in code", async () => {
    const res = await POST(
      makeRequest("POST", URL_BASE, { code: "BAD CODE!", discount_type: "percent", percent_off: 10 })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/A.Z/);
  });

  it("rejects percent_off out of range", async () => {
    for (const value of [0, -5, 150]) {
      const res = await POST(
        makeRequest("POST", URL_BASE, { code: "X", discount_type: "percent", percent_off: value })
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects amount_off without currency", async () => {
    const res = await POST(
      makeRequest("POST", URL_BASE, { code: "X", discount_type: "amount", amount_off_cents: 500 })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/currency/i);
  });

  it("rejects expires_at in the past", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const res = await POST(
      makeRequest("POST", URL_BASE, {
        code: "X",
        discount_type: "percent",
        percent_off: 10,
        expires_at: past,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects offer reference when the offer is not synced to Stripe", async () => {
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "offer-1", stripe_product_id: null } }),
    }));
    const res = await POST(
      makeRequest("POST", URL_BASE, {
        code: "X",
        discount_type: "percent",
        percent_off: 10,
        offer_id: "offer-1",
      })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/synced/i);
  });
});

describe("POST /api/admin/coupons — happy paths", () => {
  it("creates a Stripe coupon + promotion code with applies_to.products for an offer", async () => {
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "offer-1", stripe_product_id: "prod_abc" } }),
    }));
    mockStripe.coupons.create.mockResolvedValue({
      id: "coupon_new",
      percent_off: 15,
      amount_off: null,
      currency: null,
    });
    mockStripe.promotionCodes.create.mockResolvedValue({
      id: "promo_new",
      code: "FIFTEEN",
      active: true,
      max_redemptions: 50,
      times_redeemed: 0,
      expires_at: null,
    });

    const res = await POST(
      makeRequest("POST", URL_BASE, {
        code: "FIFTEEN",
        discount_type: "percent",
        percent_off: 15,
        offer_id: "offer-1",
        max_redemptions: 50,
      })
    );
    expect(res.status).toBe(200);
    expect(mockStripe.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: "once",
        percent_off: 15,
        applies_to: { products: ["prod_abc"] },
        metadata: expect.objectContaining({ source: "hexii", offer_id: "offer-1" }),
      })
    );
    expect(mockStripe.promotionCodes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: { type: "coupon", coupon: "coupon_new" },
        code: "FIFTEEN",
        max_redemptions: 50,
      })
    );
  });

  it("creates an amount_off coupon without applies_to when no offer is given", async () => {
    mockStripe.coupons.create.mockResolvedValue({
      id: "coupon_amt",
      percent_off: null,
      amount_off: 1000,
      currency: "usd",
    });
    mockStripe.promotionCodes.create.mockResolvedValue({
      id: "promo_amt",
      code: "TENBUCKS",
      active: true,
      max_redemptions: null,
      times_redeemed: 0,
      expires_at: null,
    });

    const res = await POST(
      makeRequest("POST", URL_BASE, {
        code: "TENBUCKS",
        discount_type: "amount",
        amount_off_cents: 1000,
        currency: "usd",
      })
    );
    expect(res.status).toBe(200);
    const couponCall = mockStripe.coupons.create.mock.calls[0][0];
    expect(couponCall.amount_off).toBe(1000);
    expect(couponCall.currency).toBe("usd");
    expect(couponCall.applies_to).toBeUndefined();
  });

  it("rolls back the coupon when promotion code creation fails", async () => {
    mockStripe.coupons.create.mockResolvedValue({ id: "coupon_orphan" });
    mockStripe.promotionCodes.create.mockRejectedValue(new Error("code already exists"));
    mockStripe.coupons.del.mockResolvedValue({ id: "coupon_orphan", deleted: true });

    const res = await POST(
      makeRequest("POST", URL_BASE, {
        code: "DUP",
        discount_type: "percent",
        percent_off: 10,
      })
    );
    expect(res.status).toBe(400);
    expect(mockStripe.coupons.del).toHaveBeenCalledWith("coupon_orphan");
  });
});

describe("DELETE /api/admin/coupons/[code]", () => {
  it("deactivates the promotion code and best-effort deletes the coupon", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "promo_x",
          code: "GONE",
          promotion: { type: "coupon", coupon: "coupon_x" },
        },
      ],
    });
    mockStripe.promotionCodes.update.mockResolvedValue({ id: "promo_x", active: false });
    mockStripe.coupons.del.mockResolvedValue({ id: "coupon_x", deleted: true });

    const res = await DELETE(makeRequest("DELETE", `${URL_BASE}/GONE`), {
      params: makeParams({ code: "GONE" }),
    });
    expect(res.status).toBe(200);
    expect(mockStripe.promotionCodes.update).toHaveBeenCalledWith("promo_x", { active: false });
    expect(mockStripe.coupons.del).toHaveBeenCalledWith("coupon_x");
  });

  it("still succeeds when the coupon delete fails", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [
        {
          id: "promo_y",
          code: "KEEP",
          promotion: { type: "coupon", coupon: "coupon_y" },
        },
      ],
    });
    mockStripe.promotionCodes.update.mockResolvedValue({ id: "promo_y", active: false });
    mockStripe.coupons.del.mockRejectedValue(new Error("has redemptions"));

    const res = await DELETE(makeRequest("DELETE", `${URL_BASE}/KEEP`), {
      params: makeParams({ code: "KEEP" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns an error when the code is unknown", async () => {
    mockStripe.promotionCodes.list.mockResolvedValue({ data: [] });
    const res = await DELETE(makeRequest("DELETE", `${URL_BASE}/MISSING`), {
      params: makeParams({ code: "MISSING" }),
    });
    expect(res.status).toBe(400);
  });
});
