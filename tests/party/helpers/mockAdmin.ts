import { vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase admin client mock
//
// Route handlers keep a module-scoped `const admin = createAdminClient()`.
// We expose individual spy handles so tests can configure return values with
// mockResolvedValueOnce(...) before calling the route handler.
//
// Pattern:
//   mockSingle.mockResolvedValueOnce({ data: {...}, error: null })
//   mockRpc.mockResolvedValueOnce({ data: "ABC123", error: null })
// ─────────────────────────────────────────────────────────────────────────────

export const mockSingle = vi.fn();
export const mockMaybeSingle = vi.fn();
export const mockRpc = vi.fn();
export const mockFrom = vi.fn();

// Chainable builder — all intermediate methods return this same object.
// Terminal methods (single, maybeSingle) are individual spies.
export const mockBuilder = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};

export const mockAdmin = {
  from: vi.fn().mockReturnValue(mockBuilder),
  rpc: mockRpc,
};

// ─── vi.mock call ─────────────────────────────────────────────────────────────
// Each test file calls `setupAdminMock()` inside a `vi.mock` factory.
// Because vi.mock is hoisted, the factory is called before any imports,
// which is exactly when the module-scoped `createAdminClient()` runs.

export function setupAdminMock() {
  return {
    createAdminClient: () => mockAdmin,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a standard Request for route handler tests */
export function makeRequest(
  method: string,
  url: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

/** Params object for Next.js dynamic route handlers */
export function makeParams<T extends Record<string, string>>(values: T): Promise<T> {
  return Promise.resolve(values);
}

/** Unwrap a route response to JSON */
export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
