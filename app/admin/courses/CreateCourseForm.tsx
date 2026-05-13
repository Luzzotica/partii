'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreateCourseForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, slug }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? 'Failed');
      return;
    }
    router.push(`/admin/courses/${data.course.id}`);
    router.refresh();
  }

  function autoSlug(value: string) {
    setTitle(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      );
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap gap-3 items-end">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs uppercase tracking-wider text-white/50 mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => autoSlug(e.target.value)}
          required
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
        />
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs uppercase tracking-wider text-white/50 mb-1">Slug</label>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          required
          pattern="[a-z0-9-]+"
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create course'}
      </button>
      {err && <p className="basis-full text-sm text-red-400">{err}</p>}
    </form>
  );
}
