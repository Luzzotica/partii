import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Accept JSON or form body
  const contentType = req.headers.get('content-type') ?? '';
  let course_id = '';
  if (contentType.includes('application/json')) {
    const body = await req.json();
    course_id = String(body.course_id ?? '');
  } else {
    const form = await req.formData();
    course_id = String(form.get('course_id') ?? '');
  }
  if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: course } = await admin
    .from('courses')
    .select('id, slug, is_free, is_published')
    .eq('id', course_id)
    .single();
  if (!course || !course.is_published || !course.is_free) {
    return NextResponse.json({ error: 'Course not available for free enrollment' }, { status: 403 });
  }

  await admin
    .from('enrollments')
    .upsert(
      { user_id: user.id, course_id, source: 'free' },
      { onConflict: 'user_id,course_id', ignoreDuplicates: true }
    );

  // Form posts get redirected back to the course outline; JSON gets JSON
  if (contentType.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL(`/learn/${course.slug}`, req.url), 303);
}
