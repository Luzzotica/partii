'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  lessonId: string;
  hasVideo: boolean;
  durationSeconds: number | null;
};

export function MuxUploader({ lessonId, hasVideo, durationSeconds }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setMsg(null);
    setProgress(0);
    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}/upload-url`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to get upload URL');
      }
      const { upload_url } = (await res.json()) as { upload_url: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });

      setMsg('Uploaded — Mux is processing. Refresh in a moment to see playback.');
      setProgress(100);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <strong className="text-white">Video:</strong>{' '}
          {hasVideo ? (
            <span className="text-emerald-400">
              Ready{durationSeconds ? ` (${durationSeconds}s)` : ''}
            </span>
          ) : (
            <span className="text-white/60">Not uploaded</span>
          )}
        </div>
        <label className="px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5 cursor-pointer">
          {hasVideo ? 'Replace video' : 'Upload video'}
          <input
            type="file"
            accept="video/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {progress !== null && busy && (
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[#5a67fa] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </div>
  );
}
