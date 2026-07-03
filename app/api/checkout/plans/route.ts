import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { getStripe } from "@/lib/stripe/client";
import { priceIdByLookup, proCheckoutParams, PRO_PRICE_LOOKUP, OVERAGE_PRICE_LOOKUP } from "@/lib/billing/plans";

const admin = createAdminClient();

// POST /api/checkout/plans  { project_id? }
// Upgrade the ACCOUNT to Lobbii Pro ($5/mo + metered relay overage):
// unlimited projects and API keys; every project gets pro quotas.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string };
  try { body = await request.json(); } catch { body = {}; }

  const { data: account } = await admin
    .from("billing_accounts")
    .select("plan, stripe_customer_id")
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (account?.plan === "pro") {
    return NextResponse.json({ error: "Account is already on Pro" }, { status: 409 });
  }

  const stripe = getStripe();
  const [proPriceId, overagePriceId] = await Promise.all([
    priceIdByLookup(PRO_PRICE_LOOKUP),
    priceIdByLookup(OVERAGE_PRICE_LOOKUP),
  ]);
  const baseUrl = new URL(request.url).origin;
  const params = proCheckoutParams({
    userId: auth.user.userId,
    userEmail: auth.user.email,
    proPriceId,
    overagePriceId,
    baseUrl,
    returnProjectId: body.project_id,
  });
  if (account?.stripe_customer_id) {
    params.customer = account.stripe_customer_id;
    delete params.customer_email;
  }
  const session = await stripe.checkout.sessions.create(params);
  return NextResponse.json({ url: session.url });
}
