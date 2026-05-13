import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendAccessGrantedEmail } from '@/lib/email/sendAccessGranted';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async (admin) => {
    const db = createAdminClient();
    const user_id = String(body.user_id ?? '');
    const course_id = String(body.course_id ?? '');
    if (!user_id || !course_id) throw new Error('user_id and course_id required');

    // When called via ADMIN_API_TOKEN (no real user), admin.userId is a
    // placeholder zero-UUID — store null instead so the granted_by FK is satisfied.
    const grantedBy = admin.userId === '00000000-0000-0000-0000-000000000000' ? null : admin.userId;
    const { data, error } = await db
      .from('enrollments')
      .upsert(
        { user_id, course_id, source: 'manual', granted_by: grantedBy },
        { onConflict: 'user_id,course_id' }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    await sendAccessGrantedEmail({ userId: user_id, courseId: course_id }).catch(() => {});

    return { enrollment: data };
  });
}
