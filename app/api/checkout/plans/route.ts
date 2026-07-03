import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { getStripe } from "@/lib/stripe/client";
import { priceIdByLookup, proCheckoutParams, PRO_PRICE_LOOKUP, OVERAGE_PRICE_LOOKUP } from "@/lib/billing/plans";

const admin = createAdminClient();

// POST /api/checkout/plans  { project_id }
// Upgrade a project to Lobbii Pro: $5/mo flat + metered relay overage.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const { data: project } = await admin
    .from("projects")
    .select("id, plan, stripe_customer_id")
    .eq("id", body.project_id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.plan === "pro") {
    return NextResponse.json({ error: "Project is already on Pro" }, { status: 409 });
  }

  const stripe = getStripe();
  const [proPriceId, overagePriceId] = await Promise.all([
    priceIdByLookup(PRO_PRICE_LOOKUP),
    priceIdByLookup(OVERAGE_PRICE_LOOKUP),
  ]);
  const baseUrl = new URL(request.url).origin;
  const params = proCheckoutParams({
    projectId: project.id,
    userId: auth.user.userId,
    userEmail: auth.user.email,
    proPriceId,
    overagePriceId,
    baseUrl,
  });
  if (project.stripe_customer_id) {
    params.customer = project.stripe_customer_id;
    delete params.customer_email;
  }
  const session = await stripe.checkout.sessions.create(params);
  return NextResponse.json({ url: session.url });
}
