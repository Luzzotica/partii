import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { error } = await admin.from('enrollments').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
