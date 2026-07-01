import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResend, RESEND_FROM } from "@/lib/email/resend";

const admin = createAdminClient();

// GET /api/cron/usage-alert
// Vercel cron (hourly). Revocation is the kill-switch; this is the smoke
// detector — it watches for the signature of a leaked key being abused (a flood
// of room creations, or a TURN bandwidth blowout) and emails so you notice in
// minutes instead of on the next bill.
//
// Thresholds are intentionally generous defaults; tune via env.
const ROOMS_PER_HOUR_ALERT = Number(process.env.USAGE_ALERT_ROOMS_PER_HOUR ?? 500);
const TURN_GB_PER_DAY_ALERT = Number(process.env.USAGE_ALERT_TURN_GB_PER_DAY ?? 10);
const ALERT_TO = process.env.USAGE_ALERT_TO ?? "ster@sterlinglong.me";

export async function GET(request: Request) {
  // Optional shared-secret guard (Vercel sets `Authorization: Bearer <CRON_SECRET>`).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const alerts: string[] = [];

  // 1. Room-creation flood in the last hour, tallied per api_key.
  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: events } = await admin
    .from("usage_events")
    .select("api_key_id")
    .eq("event_type", "room.create")
    .gte("created_at", sinceHour);
  const roomCounts = new Map<string, number>();
  for (const e of events ?? []) {
    roomCounts.set(e.api_key_id, (roomCounts.get(e.api_key_id) ?? 0) + 1);
  }
  for (const [keyId, count] of roomCounts) {
    if (count >= ROOMS_PER_HOUR_ALERT) {
      alerts.push(`API key ${keyId}: ${count} rooms created in the last hour (≥ ${ROOMS_PER_HOUR_ALERT}).`);
    }
  }

  // 2. TURN bandwidth blowout today (UTC), per api_key.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: turn } = await admin
    .from("turn_usage_daily")
    .select("api_key_id, bytes_total, day")
    .gte("day", startOfDay.toISOString());
  const gbCap = TURN_GB_PER_DAY_ALERT * 1024 ** 3;
  for (const row of turn ?? []) {
    const total = Number(row.bytes_total ?? 0);
    if (total >= gbCap) {
      const gb = (total / 1024 ** 3).toFixed(1);
      alerts.push(`API key ${row.api_key_id}: ${gb} GB of TURN relay today (≥ ${TURN_GB_PER_DAY_ALERT} GB).`);
    }
  }

  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, alerts: 0 });
  }

  const resend = getResend();
  if (resend) {
    await resend.emails.send({
      from: RESEND_FROM,
      to: ALERT_TO,
      subject: `⚠️ arcadii usage spike — ${alerts.length} alert(s)`,
      text:
        "Possible API-key abuse detected:\n\n" +
        alerts.map((a) => `• ${a}`).join("\n") +
        "\n\nIf this isn't you, revoke the affected key(s) in the developer dashboard.",
    });
  }

  return NextResponse.json({ ok: true, alerts: alerts.length, detail: alerts });
}
