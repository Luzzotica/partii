import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setupAdminMock,
  setupSendAccessGrantedMock,
  mockAdminFrom,
  mockSendAccessGranted,
  resetAllMocks,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/admin", () => setupAdminMock());
vi.mock("@/lib/email/sendAccessGranted", () => setupSendAccessGrantedMock());

import { grantOfferAccess } from "@/lib/checkout/grantOfferAccess";

beforeEach(() => {
  resetAllMocks();
});

describe("grantOfferAccess", () => {
  it("upserts an enrollment per linked course and returns slugs", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offer_courses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ course_id: "c-A" }, { course_id: "c-B" }],
            error: null,
          }),
        };
      }
      if (table === "enrollments") return { upsert };
      if (table === "courses") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [{ slug: "alpha" }, { slug: "beta" }],
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await grantOfferAccess({
      userId: "u-1",
      offerId: "o-1",
      paymentRef: "pi_test",
    });

    expect(result.courseIds).toEqual(["c-A", "c-B"]);
    expect(result.courseSlugs).toEqual(["alpha", "beta"]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        user_id: "u-1",
        course_id: "c-A",
        source: "stripe",
        offer_id: "o-1",
        stripe_checkout_id: "pi_test",
      }),
      { onConflict: "user_id,course_id" }
    );
    expect(mockSendAccessGranted).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when the offer has no courses", async () => {
    const upsert = vi.fn();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offer_courses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === "enrollments") return { upsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await grantOfferAccess({
      userId: "u-1",
      offerId: "o-empty",
      paymentRef: "pi_x",
    });

    expect(result).toEqual({ courseIds: [], courseSlugs: [] });
    expect(upsert).not.toHaveBeenCalled();
    expect(mockSendAccessGranted).not.toHaveBeenCalled();
  });

  it("swallows email failures so a flaky mailer doesn't block enrollment", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "offer_courses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ course_id: "c-A" }], error: null }),
        };
      }
      if (table === "enrollments") return { upsert };
      if (table === "courses") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ slug: "alpha" }], error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockSendAccessGranted.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      grantOfferAccess({ userId: "u-1", offerId: "o-1", paymentRef: "pi_x" })
    ).resolves.toMatchObject({ courseSlugs: ["alpha"] });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
