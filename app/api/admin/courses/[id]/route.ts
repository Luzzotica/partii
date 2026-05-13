import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { data: course, error: cErr } = await admin
      .from('courses')
      .select('*')
      .eq('id', id)
      .single();
    if (cErr) throw new Error(cErr.message);
    const { data: modules } = await admin
      .from('modules')
      .select('*')
      .eq('course_id', id)
      .order('position');
    const moduleIds = (modules ?? []).map((m) => m.id);
    const { data: lessons } = moduleIds.length
      ? await admin.from('lessons').select('*').in('module_id', moduleIds).order('position')
      : { data: [] as never[] };
    return { course, modules: modules ?? [], lessons: lessons ?? [] };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {};
    for (const k of [
      'slug',
      'title',
      'subtitle',
      'description',
      'cover_image_url',
      'is_published',
      'is_free',
    ]) {
      if (k in body) patch[k] = body[k];
    }
    const { data, error } = await admin
      .from('courses')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { course: data };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { error } = await admin.from('courses').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
