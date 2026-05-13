import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const module_id = String(body.module_id ?? '');
    const title = String(body.title ?? '').trim();
    if (!module_id || !title) throw new Error('module_id and title required');

    const { data: existing } = await admin
      .from('lessons')
      .select('position')
      .eq('module_id', module_id)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;

    const { data, error } = await admin
      .from('lessons')
      .insert({
        module_id,
        title,
        position: nextPos,
        content_json: { type: 'doc', content: [{ type: 'paragraph' }] },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { lesson: data };
  });
}
