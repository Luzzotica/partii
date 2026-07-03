import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { getStripe } from "@/lib/stripe/client";

const admin = createAdminClient();

// POST /api/billing/portal  { project_id }
// Stripe billing-portal session for managing/cancelling the project's plan.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string };
  try { body = await request.json(); } catch { body = {}; }

  const { data: account } = await admin
    .from("billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!account?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing on this account yet" }, { status: 409 });
  }

  const back = body.project_id
    ? `${new URL(request.url).origin}/developer/projects/${body.project_id}`
    : `${new URL(request.url).origin}/developer`;
  const session = await getStripe().billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: back,
  });
  return NextResponse.json({ url: session.url });
}
