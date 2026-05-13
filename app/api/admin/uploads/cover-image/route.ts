import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  return withAdmin(async () => {
    if (!(file instanceof File)) throw new Error('file required');
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }
    if (file.size > MAX_BYTES) throw new Error('File too large (max 8 MB)');

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'png';
    const path = `${crypto.randomUUID()}.${safeExt}`;

    const admin = createAdminClient();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await admin.storage.from('cover-images').upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data } = admin.storage.from('cover-images').getPublicUrl(path);
    return { url: data.publicUrl, path };
  });
}

export async function GET() {
  return NextResponse.json({ error: 'POST a multipart form with file=<image>' }, { status: 405 });
}
