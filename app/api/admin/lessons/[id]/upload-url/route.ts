import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMux } from '@/lib/mux/client';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id: lessonId } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { data: lesson, error: lErr } = await admin
      .from('lessons')
      .select('id')
      .eq('id', lessonId)
      .single();
    if (lErr || !lesson) throw new Error('Lesson not found');

    const mux = getMux();
    const upload = await mux.video.uploads.create({
      cors_origin: '*',
      new_asset_settings: {
        playback_policy: ['public'],
        passthrough: lessonId,
      },
    });

    await admin
      .from('lessons')
      .update({ mux_upload_id: upload.id })
      .eq('id', lessonId);

    return { upload_url: upload.url, upload_id: upload.id };
  });
}
