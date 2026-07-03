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
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const { data: project } = await admin
    .from("projects")
    .select("id, stripe_customer_id")
    .eq("id", body.project_id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.stripe_customer_id) {
    return NextResponse.json({ error: "No billing on this project yet" }, { status: 409 });
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: project.stripe_customer_id,
    return_url: `${new URL(request.url).origin}/developer/projects/${project.id}`,
  });
  return NextResponse.json({ url: session.url });
}
