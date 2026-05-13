import { vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase admin (service-role) — module-scoped `const admin = createAdminClient()`
// ─────────────────────────────────────────────────────────────────────────────

export const mockSingle = vi.fn();
export const mockMaybeSingle = vi.fn();
export const mockUpsert = vi.fn();

function freshBuilder() {
  const b: Record<string, unknown> = {};
  b.select = vi.fn().mockReturnValue(b);
  b.insert = vi.fn().mockReturnValue(b);
  b.update = vi.fn().mockReturnValue(b);
  b.delete = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockReturnValue(b);
  b.in = vi.fn().mockReturnValue(b);
  b.order = vi.fn().mockReturnValue(b);
  b.limit = vi.fn().mockReturnValue(b);
  b.single = mockSingle;
  b.maybeSingle = mockMaybeSingle;
  b.upsert = mockUpsert;
  // For "await admin.from('x').select(...).eq(...)" patterns that don't use single/maybeSingle:
  b.then = undefined;
  return b;
}

export const mockAdminFrom: ReturnType<typeof vi.fn> = vi.fn((_table?: string) => freshBuilder());

export const mockAdmin = {
  from: mockAdminFrom,
};

export function setupAdminMock() {
  return { createAdminClient: () => mockAdmin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase user client — `await createClient()` then `supabase.auth.getUser()`
// ─────────────────────────────────────────────────────────────────────────────

export const mockGetUser = vi.fn();

export const mockSupabaseClient = {
  auth: { getUser: mockGetUser },
};

export function setupSupabaseServerMock() {
  return { createClient: async () => mockSupabaseClient };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe SDK
// ─────────────────────────────────────────────────────────────────────────────

export const mockStripe = {
  paymentIntents: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
  },
  promotionCodes: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  coupons: {
    create: vi.fn(),
    del: vi.fn(),
  },
  products: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
  prices: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
  webhooks: {
    constructEvent: vi.fn(),
  },
};

export let stripeWebhookSecret = "whsec_test";

export function setStripeWebhookSecret(value: string) {
  stripeWebhookSecret = value;
}

export function setupStripeClientMock() {
  return {
    getStripe: () => mockStripe,
    get STRIPE_WEBHOOK_SECRET() {
      return stripeWebhookSecret;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Other dependencies the routes touch
// ─────────────────────────────────────────────────────────────────────────────

export const mockSyncOfferToStripe = vi.fn();
export function setupSyncOfferMock() {
  return {
    syncOfferToStripe: mockSyncOfferToStripe,
    archiveOfferInStripe: vi.fn(),
  };
}

export const mockSendAccessGranted = vi.fn().mockResolvedValue(undefined);
export function setupSendAccessGrantedMock() {
  return { sendAccessGrantedEmail: mockSendAccessGranted };
}

// withAdmin: bypass auth in tests, call the handler with a fake admin context.
export function setupAdminGuardMock() {
  return {
    withAdmin: async <T,>(handler: (ctx: { userId: string; email: string | null }) => Promise<T>) => {
      try {
        const data = await handler({ userId: "admin-user", email: "admin@test" });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from "next/server";

export function makeRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json", ...(headers ?? {}) };
  } else if (headers) {
    init.headers = headers;
  }
  return new Request(url, init) as unknown as NextRequest;
}

export function makeParams<T extends Record<string, string>>(values: T): Promise<T> {
  return Promise.resolve(values);
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

// Async-iterator factory for stripe.list pagination
export function asyncIter<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) yield item;
    },
  };
}

// Convenience: stage the next from() call to return a builder whose terminal
// resolves with the given value. Allows readable per-test setup.
export function stageSingle(value: unknown) {
  mockSingle.mockResolvedValueOnce(value);
}
export function stageMaybeSingle(value: unknown) {
  mockMaybeSingle.mockResolvedValueOnce(value);
}

export function resetAllMocks() {
  vi.clearAllMocks();
  // re-install default builder return for from()
  mockAdminFrom.mockImplementation(() => freshBuilder());
  stripeWebhookSecret = "whsec_test";
}
