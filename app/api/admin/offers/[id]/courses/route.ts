import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const course_id = String(body.course_id ?? '');
    if (!course_id) throw new Error('course_id required');
    const position = Number.isFinite(body.position) ? Math.floor(body.position) : 0;
    const { error } = await admin
      .from('offer_courses')
      .upsert({ offer_id: id, course_id, position }, { onConflict: 'offer_id,course_id' });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const course_id = url.searchParams.get('course_id') ?? '';
  return withAdmin(async () => {
    if (!course_id) throw new Error('course_id required');
    const admin = createAdminClient();
    const { error } = await admin
      .from('offer_courses')
      .delete()
      .eq('offer_id', id)
      .eq('course_id', course_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
