import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResend, RESEND_FROM } from '@/lib/email/resend';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const course_id = String(body.course_id ?? '');
    const subject = String(body.subject ?? '').trim();
    const html = String(body.body_html ?? '').trim();
    if (!course_id || !subject || !html) {
      throw new Error('course_id, subject, body_html required');
    }

    const resend = getResend();
    if (!resend) {
      throw new Error('Email is not configured. Set RESEND_API_KEY to enable broadcasts.');
    }

    const { data: enrollments } = await admin
      .from('enrollments')
      .select('user_id')
      .eq('course_id', course_id);
    const userIds = [...new Set((enrollments ?? []).map((e) => e.user_id))];
    if (userIds.length === 0) return { sent: 0, failed: 0 };

    const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emailById = new Map<string, string>();
    for (const u of authUsers?.users ?? []) {
      if (u.email && userIds.includes(u.id)) emailById.set(u.id, u.email);
    }

    let sent = 0;
    let failed = 0;
    const logs: Array<Record<string, unknown>> = [];

    for (const userId of userIds) {
      const to = emailById.get(userId);
      if (!to) {
        failed++;
        continue;
      }
      try {
        const { data, error } = await resend.emails.send({
          from: RESEND_FROM,
          to,
          subject,
          html,
        });
        if (error) {
          failed++;
          logs.push({
            user_id: userId,
            course_id,
            kind: 'broadcast',
            subject,
            to_email: to,
            status: 'failed',
            error: error.message,
          });
        } else {
          sent++;
          logs.push({
            user_id: userId,
            course_id,
            kind: 'broadcast',
            subject,
            to_email: to,
            status: 'sent',
            resend_id: data?.id ?? null,
          });
        }
      } catch (err) {
        failed++;
        logs.push({
          user_id: userId,
          course_id,
          kind: 'broadcast',
          subject,
          to_email: to,
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    if (logs.length) await admin.from('email_log').insert(logs);
    return { sent, failed, recipients: userIds.length };
  });
}
