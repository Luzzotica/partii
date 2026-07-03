import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";

const admin = createAdminClient();

// ─────────────────────────────────────────────────────────────────────────────
// Daily metered-billing cron (vercel.json): report pro projects' relay
// bandwidth OVERAGE (beyond relay_included_gb) to the Stripe billing meter.
//
// Idempotency: relay_usage_reports keeps the cumulative WHOLE GB already
// reported per project per calendar month; each run reports only the delta.
// Meter values are integers (whole GB) — fractional overage carries to the
// next run/month via the floor bookkeeping.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const period = monthStart.toISOString().slice(0, 7); // 'YYYY-MM'

  const { data: projects, error } = await admin
    .from("projects")
    .select("id, plan, relay_included_gb, stripe_customer_id")
    .eq("plan", "pro")
    .not("stripe_customer_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stripe = getStripe();
  const results: Array<Record<string, unknown>> = [];

  for (const proj of projects ?? []) {
    const { data: keys } = await admin.from("api_keys").select("id").eq("project_id", proj.id);
    const keyIds = (keys ?? []).map((k) => k.id);
    if (keyIds.length === 0) continue;

    const { data: usage } = await admin
      .from("turn_usage")
      .select("bytes_sent, bytes_received")
      .in("api_key_id", keyIds)
      .gte("ended_at", monthStart.toISOString());
    const bytes = (usage ?? []).reduce((a, r) => a + (r.bytes_sent ?? 0) + (r.bytes_received ?? 0), 0);
    const usedGb = bytes / 1e9;
    const overageGb = Math.max(0, Math.floor(usedGb - (proj.relay_included_gb ?? 25)));

    const { data: report } = await admin
      .from("relay_usage_reports")
      .select("reported_gb")
      .eq("project_id", proj.id)
      .eq("period", period)
      .maybeSingle();
    const alreadyReported = Number(report?.reported_gb ?? 0);
    const delta = overageGb - alreadyReported;
    if (delta <= 0) {
      results.push({ project: proj.id, usedGb: usedGb.toFixed(2), delta: 0 });
      continue;
    }

    await stripe.billing.meterEvents.create({
      event_name: "lobbii_relay_gb",
      payload: {
        stripe_customer_id: proj.stripe_customer_id as string,
        value: String(delta),
      },
    });
    await admin
      .from("relay_usage_reports")
      .upsert(
        { project_id: proj.id, period, reported_gb: overageGb, updated_at: new Date().toISOString() },
        { onConflict: "project_id,period" },
      );
    results.push({ project: proj.id, usedGb: usedGb.toFixed(2), delta });
  }

  return NextResponse.json({ period, projects: results.length, results });
}
