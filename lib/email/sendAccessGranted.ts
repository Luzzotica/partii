import { createAdminClient } from '@/lib/supabase/admin';
import { getResend, RESEND_FROM } from './resend';

type Args = { userId: string; courseId: string };

/**
 * Sends a transactional "you have access to <course>" email and records the
 * attempt in email_log. This function never throws — callers can `await` it
 * without try/catch and a missing/broken Resend setup will not break the
 * surrounding flow (enrollment, redemption, Stripe webhook, etc.).
 */
export async function sendAccessGrantedEmail({ userId, courseId }: Args): Promise<void> {
  try {
    // Fast exit if Resend isn't configured — don't even hit the DB.
    const resend = getResend();
    if (!resend) return;

    const admin = createAdminClient();

    const [{ data: profile }, { data: course }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', userId).single(),
      admin.from('courses').select('slug, title').eq('id', courseId).single(),
    ]);
    if (!course) return;

    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const courseUrl = `${appUrl}/learn/${course.slug}`;
    const greeting = profile?.display_name ? `Hi ${profile.display_name},` : 'Hi,';
    const subject = `You now have access to ${course.title}`;
    const html = `
      <p>${greeting}</p>
      <p>You now have access to <strong>${escapeHtml(course.title)}</strong>.</p>
      <p><a href="${courseUrl}">Start the course →</a></p>
    `;

    let status: 'sent' | 'failed' = 'failed';
    let resendId: string | null = null;
    let errorMsg: string | null = null;
    try {
      const { data, error } = await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject,
        html,
      });
      if (error) {
        errorMsg = error.message;
      } else {
        status = 'sent';
        resendId = data?.id ?? null;
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'unknown error';
    }

    try {
      await admin.from('email_log').insert({
        user_id: userId,
        course_id: courseId,
        kind: 'access_granted',
        subject,
        to_email: email,
        status,
        resend_id: resendId,
        error: errorMsg,
      });
    } catch {
      // email_log is best-effort; ignore failures here too.
    }
  } catch (err) {
    // Last-resort guard: log to server console but never throw.
    console.error('[sendAccessGrantedEmail] unexpected error:', err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
