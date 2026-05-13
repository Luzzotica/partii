import { createAdminClient } from '@/lib/supabase/admin';
import { sendAccessGrantedEmail } from '@/lib/email/sendAccessGranted';

type Result = {
  courseIds: string[];
  courseSlugs: string[];
};

/**
 * Idempotently grants a user access to every course attached to an offer.
 * Called from both the Stripe webhook and the post-checkout return page so a
 * customer can never beat their own enrollment write.
 *
 * `paymentRef` ends up on the enrollment row's `stripe_checkout_id` column for
 * audit, and is what makes repeat calls safe — the upsert on (user, course)
 * just overwrites the same row.
 */
export async function grantOfferAccess(opts: {
  userId: string;
  offerId: string;
  paymentRef: string;
}): Promise<Result> {
  const admin = createAdminClient();

  const { data: links } = await admin
    .from('offer_courses')
    .select('course_id')
    .eq('offer_id', opts.offerId);

  const courseIds = (links ?? []).map((l) => l.course_id as string);
  if (courseIds.length === 0) {
    return { courseIds: [], courseSlugs: [] };
  }

  for (const courseId of courseIds) {
    await admin.from('enrollments').upsert(
      {
        user_id: opts.userId,
        course_id: courseId,
        source: 'stripe',
        offer_id: opts.offerId,
        stripe_checkout_id: opts.paymentRef,
      },
      { onConflict: 'user_id,course_id' }
    );
    await sendAccessGrantedEmail({ userId: opts.userId, courseId }).catch(() => {});
  }

  const { data: courses } = await admin
    .from('courses')
    .select('slug')
    .in('id', courseIds);
  const courseSlugs = (courses ?? []).map((c) => c.slug as string);

  return { courseIds, courseSlugs };
}
