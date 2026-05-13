import { createClient } from '@/lib/supabase/server';

export type AdminContext = {
  userId: string;
  email: string | null;
};

/**
 * Resolve the current user via the cookie-bound SSR client and verify they
 * have profiles.is_admin = true. Used by /admin pages and /api/admin routes.
 */
export async function requireAdmin(): Promise<
  { ok: true; admin: AdminContext } | { ok: false; status: 401 | 403 }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) return { ok: false, status: 403 };

  return { ok: true, admin: { userId: user.id, email: user.email ?? null } };
}
