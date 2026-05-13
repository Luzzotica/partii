import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const course_id = String(body.course_id ?? '');
    const title = String(body.title ?? '').trim();
    if (!course_id || !title) throw new Error('course_id and title required');

    const { data: existing } = await admin
      .from('modules')
      .select('position')
      .eq('course_id', course_id)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;

    const { data, error } = await admin
      .from('modules')
      .insert({ course_id, title, position: nextPos })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { module: data };
  });
}
