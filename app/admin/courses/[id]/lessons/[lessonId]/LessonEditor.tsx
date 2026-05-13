'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/react';
import { TiptapEditor } from '@/components/admin/TiptapEditor';
import { MuxUploader } from '@/components/admin/MuxUploader';
import type { Lesson } from '@/lib/learn/types';

export function LessonEditor({ lesson, courseId }: { lesson: Lesson; courseId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState<JSONContent>(
    (lesson.content_json as JSONContent | null) ?? { type: 'doc', content: [{ type: 'paragraph' }] }
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/admin/lessons/${lesson.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, content_json: content }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg('Saved');
      router.refresh();
    } else {
      const data = await res.json();
      setMsg(data.error ?? 'Failed');
    }
  }

  async function remove() {
    if (!confirm(`Delete lesson "${lesson.title}"?`)) return;
    const res = await fetch(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE' });
    if (res.ok) router.push(`/admin/courses/${courseId}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 text-2xl font-semibold bg-transparent border-b border-white/10 focus:border-white/30 px-1 py-2 outline-none"
        />
        <button onClick={remove} className="text-xs text-red-400 hover:underline">
          Delete
        </button>
      </div>

      <MuxUploader
        lessonId={lesson.id}
        hasVideo={!!lesson.mux_playback_id}
        durationSeconds={lesson.video_duration_seconds}
      />

      <TiptapEditor value={content} onChange={setContent} />

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save lesson'}
        </button>
        {msg && <span className="text-sm text-white/60">{msg}</span>}
      </div>
    </div>
  );
}
