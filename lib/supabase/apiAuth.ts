import { createClient } from './server';
import type { User } from '@supabase/supabase-js';

/**
 * Extract the authenticated user from either:
 * 1. Cookie-based session (same-origin Partii requests)
 * 2. Authorization: Bearer <jwt> header (cross-origin requests)
 */
export async function getApiUser(request: Request): Promise<User | null> {
  const supabase = await createClient();

  // 1. Try cookie-based auth
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  // 2. Try Bearer token
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
    return tokenUser ?? null;
  }

  return null;
}
