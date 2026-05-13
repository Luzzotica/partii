'use client';

import { useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (url: string) => void;
};

export function CoverImageUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/uploads/cover-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      onChange(data.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt="Cover"
            className="w-32 h-20 object-cover rounded border border-white/10"
          />
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5 text-red-300"
              >
                Remove
              </button>
            )}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste an image URL"
            className="w-80 max-w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded text-xs font-mono"
          />
        </div>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
