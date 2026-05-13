import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setupAdminMock,
  setupSupabaseServerMock,
  setupStripeClientMock,
  setupSyncOfferMock,
  mockGetUser,
  mockStripe,
  mockSyncOfferToStripe,
  stageSingle,
  resetAllMocks,
  makeRequest,
  makeParams,
  json,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());
vi.mock("@/lib/supabase/server", () => setupSupabaseServerMock());
vi.mock("@/lib/stripe/client", () => setupStripeClientMock());
vi.mock("@/lib/stripe/syncOffer", () => setupSyncOfferMock());

import { POST } from "@/app/api/checkout/offers/[slug]/intent/route";

const URL_BASE = "http://localhost:3000/api/checkout/offers/test-offer/intent";

beforeEach(() => {
  resetAllMocks();
});

function user() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "u@test" } } });
}

const liveOffer = {
  id: "offer-1",
  slug: "test-offer",
  name: "Test Offer",
  description: "desc",
  price_cents: 2500,
  currency: "usd",
  is_published: true,
  stripe_product_id: "prod_123",
  stripe_price_id: "price_123",
};

describe("POST /api/checkout/offers/[slug]/intent", () => {
  it("rejects unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when offer is unpublished", async () => {
    user();
    stageSingle({ data: { ...liveOffer, is_published: false }, error: null });
    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when offer is free", async () => {
    user();
    stageSingle({ data: { ...liveOffer, price_cents: 0 }, error: null });
    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    expect(res.status).toBe(404);
  });

  it("creates a payment intent with correct metadata", async () => {
    user();
    stageSingle({ data: liveOffer, error: null });
    mockStripe.paymentIntents.create.mockResolvedValue({
      id: "pi_test_123",
      client_secret: "pi_test_123_secret_abc",
    });

    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      client_secret: "pi_test_123_secret_abc",
      payment_intent_id: "pi_test_123",
      amount: 2500,
      currency: "usd",
    });
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: "usd",
        receipt_email: "u@test",
        metadata: {
          offer_id: "offer-1",
          user_id: "user-1",
          original_amount: "2500",
        },
      })
    );
    expect(mockSyncOfferToStripe).not.toHaveBeenCalled();
  });

  it("syncs the offer to Stripe when stripe_product_id is missing", async () => {
    user();
    stageSingle({ data: { ...liveOffer, stripe_product_id: null }, error: null });
    mockSyncOfferToStripe.mockResolvedValue({ ok: true, offer: liveOffer });
    mockStripe.paymentIntents.create.mockResolvedValue({
      id: "pi_x",
      client_secret: "pi_x_secret",
    });

    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    expect(res.status).toBe(200);
    expect(mockSyncOfferToStripe).toHaveBeenCalledWith("offer-1");
  });

  it("returns 500 when sync fails", async () => {
    user();
    stageSingle({ data: { ...liveOffer, stripe_product_id: null }, error: null });
    mockSyncOfferToStripe.mockResolvedValue({ ok: false, error: "stripe down" });

    const res = await POST(makeRequest("POST", URL_BASE), { params: makeParams({ slug: "test-offer" }) });
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error).toBe("stripe down");
  });
});
