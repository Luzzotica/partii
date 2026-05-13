import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('courses')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return { courses: data };
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const slug = String(body.slug ?? '').trim().toLowerCase();
    const title = String(body.title ?? '').trim();
    if (!slug || !title) throw new Error('slug and title required');
    const { data, error } = await admin
      .from('courses')
      .insert({
        slug,
        title,
        subtitle: body.subtitle ?? null,
        description: body.description ?? null,
        is_free: Boolean(body.is_free ?? false),
        is_published: Boolean(body.is_published ?? false),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { course: data };
  });
}
