import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setupAdminMock,
  setupStripeClientMock,
  setupSendAccessGrantedMock,
  mockAdminFrom,
  mockStripe,
  mockSendAccessGranted,
  setStripeWebhookSecret,
  resetAllMocks,
  makeRequest,
  json,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());
vi.mock("@/lib/stripe/client", () => setupStripeClientMock());
vi.mock("@/lib/email/sendAccessGranted", () => setupSendAccessGrantedMock());

import { POST } from "@/app/api/webhooks/stripe/route";

const URL = "http://localhost:3000/api/webhooks/stripe";

beforeEach(() => {
  resetAllMocks();
  setStripeWebhookSecret("whsec_test");
});

function postWithSig(body: string, sig = "t=1,v1=fake") {
  return makeRequest("POST", URL, body, { "stripe-signature": sig, "Content-Type": "application/json" });
}

describe("POST /api/webhooks/stripe — guards", () => {
  it("returns 500 when STRIPE_WEBHOOK_SECRET is unset", async () => {
    setStripeWebhookSecret("");
    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(500);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const req = makeRequest("POST", URL, "{}");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid signature", async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("bad sig");
  });
});

describe("POST /api/webhooks/stripe — payment_intent.succeeded", () => {
  it("upserts an enrollment for every linked course and sends emails", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_succeeded_1",
          metadata: { user_id: "user-1", offer_id: "offer-1" },
        },
      },
    });

    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offer_courses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ course_id: "course-A" }, { course_id: "course-B" }],
            error: null,
          }),
        };
      }
      if (table === "enrollments") {
        return { upsert };
      }
      if (table === "courses") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ received: true });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        user_id: "user-1",
        course_id: "course-A",
        source: "stripe",
        offer_id: "offer-1",
        stripe_checkout_id: "pi_succeeded_1",
      }),
      { onConflict: "user_id,course_id" }
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ user_id: "user-1", course_id: "course-B" }),
      { onConflict: "user_id,course_id" }
    );
    expect(mockSendAccessGranted).toHaveBeenCalledTimes(2);
  });

  it("ignores events with no linked courses without erroring", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_2",
          metadata: { user_id: "user-1", offer_id: "offer-empty" },
        },
      },
    });
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }));

    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(200);
    expect(mockSendAccessGranted).not.toHaveBeenCalled();
  });

  it("ignores events with missing user_id or offer_id metadata", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_3", metadata: { user_id: "user-1" } } },
    });
    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(200);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it("handles checkout.session.completed events identically", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { user_id: "user-1", offer_id: "offer-1" } } },
    });
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offer_courses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ course_id: "course-A" }], error: null }),
        };
      }
      if (table === "enrollments") return { upsert };
      if (table === "courses") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      throw new Error(`unexpected ${table}`);
    });
    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "charge.refunded",
      data: { object: { id: "ch_1", metadata: { user_id: "user-1", offer_id: "offer-1" } } },
    });
    const res = await POST(postWithSig("{}"));
    expect(res.status).toBe(200);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });
});
