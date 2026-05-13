import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAdmin, type AdminContext } from '@/lib/auth/requireAdmin';
import { headers } from 'next/headers';

const TOKEN_ADMIN_ID = '00000000-0000-0000-0000-000000000000';

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function checkBearerToken(): Promise<AdminContext | null> {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return null;
  const h = await headers();
  const auth = h.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  if (!tokensEqual(m[1], expected)) return null;
  return { userId: TOKEN_ADMIN_ID, email: null };
}

export async function withAdmin<T>(
  handler: (admin: AdminContext) => Promise<T>,
  _req?: NextRequest
): Promise<NextResponse> {
  const token = await checkBearerToken();
  if (token) {
    try {
      const data = await handler(token);
      return NextResponse.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const result = await requireAdmin();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: result.status }
    );
  }
  try {
    const data = await handler(result.admin);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
