import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { MUX_WEBHOOK_SECRET } from '@/lib/mux/client';

// Mux signs webhooks with HMAC-SHA256 over `${timestamp}.${rawBody}`
// header: Mux-Signature: t=<unix>,v1=<hex>
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k.trim(), v?.trim() ?? ''];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const signed = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('mux-signature');

  if (MUX_WEBHOOK_SECRET && !verifySignature(raw, sig, MUX_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  type MuxAsset = {
    id: string;
    duration?: number;
    upload_id?: string;
    passthrough?: string;
    playback_ids?: Array<{ id: string; policy: string }>;
  };
  type MuxEvent = { type: string; data: MuxAsset };

  let event: MuxEvent;
  try {
    event = JSON.parse(raw) as MuxEvent;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (event.type !== 'video.asset.ready') {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const asset = event.data;
  const lessonId = asset.passthrough;
  if (!lessonId) return NextResponse.json({ ok: true, note: 'no passthrough' });

  const playback = asset.playback_ids?.find((p) => p.policy === 'public') ?? asset.playback_ids?.[0];

  const admin = createAdminClient();
  await admin
    .from('lessons')
    .update({
      mux_asset_id: asset.id,
      mux_playback_id: playback?.id ?? null,
      video_duration_seconds: asset.duration ? Math.round(asset.duration) : null,
    })
    .eq('id', lessonId);

  return NextResponse.json({ ok: true });
}
