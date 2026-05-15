import { createClient } from '@/lib/supabase/server';

export type UserContext = {
  userId: string;
  email: string | null;
};

export async function requireUser(): Promise<
  { ok: true; user: UserContext } | { ok: false; status: 401 }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };
  return { ok: true, user: { userId: user.id, email: user.email ?? null } };
}
