'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/react';
import { TiptapView } from '@/components/learn/TiptapView';
import { LessonVideoPlayer } from '@/components/learn/LessonVideoPlayer';
import type { Lesson, LessonProgress } from '@/lib/learn/types';

type Props = {
  lesson: Lesson;
  courseId: string;
  initialProgress: Pick<LessonProgress, 'completed' | 'watch_seconds' | 'watch_percent'> | null;
};

export function LessonView({ lesson, courseId, initialProgress }: Props) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialProgress?.completed ?? false);
  const [busy, setBusy] = useState(false);
  const hasVideo = !!lesson.mux_playback_id;

  async function markComplete() {
    setBusy(true);
    const res = await fetch('/api/learn/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lesson_id: lesson.id, course_id: courseId, completed: true }),
    });
    setBusy(false);
    if (res.ok) {
      setCompleted(true);
      router.refresh();
    }
  }

  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold">{lesson.title}</h1>

      {hasVideo && lesson.mux_playback_id && (
        <LessonVideoPlayer
          playbackId={lesson.mux_playback_id}
          lessonId={lesson.id}
          courseId={courseId}
          initialSeconds={initialProgress?.watch_seconds ?? 0}
          onCompleted={() => setCompleted(true)}
        />
      )}

      <TiptapView content={(lesson.content_json as JSONContent | null) ?? null} />

      <div className="pt-4 border-t border-white/10">
        {completed ? (
          <span className="inline-flex items-center gap-2 text-emerald-400 text-sm">
            <span className="w-4 h-4 rounded-full bg-emerald-400" />
            Marked complete
          </span>
        ) : !hasVideo ? (
          <button
            onClick={markComplete}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Mark complete'}
          </button>
        ) : (
          <span className="text-xs text-white/50">Auto-completes when you reach 90% of the video.</span>
        )}
      </div>
    </article>
  );
}
