import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {};
    for (const k of ['title', 'position']) if (k in body) patch[k] = body[k];
    const { data, error } = await admin
      .from('modules')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { module: data };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { error } = await admin.from('modules').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
