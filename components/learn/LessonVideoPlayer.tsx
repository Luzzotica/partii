'use client';

import { useEffect, useRef } from 'react';
import MuxPlayer from '@mux/mux-player-react';

type Props = {
  playbackId: string;
  lessonId: string;
  courseId: string;
  initialSeconds: number;
  onCompleted: () => void;
};

export function LessonVideoPlayer({ playbackId, lessonId, courseId, initialSeconds, onCompleted }: Props) {
  const lastSentRef = useRef(0);
  const completedRef = useRef(false);
  const playerRef = useRef<HTMLElement & { currentTime?: number } | null>(null);

  // Resume from last position
  useEffect(() => {
    const el = playerRef.current;
    if (!el || initialSeconds <= 0) return;
    try {
      (el as unknown as { currentTime: number }).currentTime = initialSeconds;
    } catch {
      // ignored
    }
  }, [initialSeconds]);

  async function sendProgress(currentSeconds: number, completed = false) {
    const res = await fetch('/api/learn/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lesson_id: lessonId,
        course_id: courseId,
        watch_seconds: Math.floor(currentSeconds),
        completed,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { completed?: boolean };
    if (data.completed && !completedRef.current) {
      completedRef.current = true;
      onCompleted();
    }
  }

  function handleTimeUpdate(e: Event) {
    const target = e.currentTarget as HTMLElement & { currentTime?: number };
    const t = target.currentTime ?? 0;
    if (t - lastSentRef.current >= 10) {
      lastSentRef.current = t;
      void sendProgress(t);
    }
  }

  function handleEnded(e: Event) {
    const target = e.currentTarget as HTMLElement & { currentTime?: number };
    void sendProgress(target.currentTime ?? 0, true);
  }

  return (
    <div className="rounded-xl overflow-hidden bg-black">
      <MuxPlayer
        ref={playerRef as never}
        playbackId={playbackId}
        streamType="on-demand"
        accentColor="#5a67fa"
        style={{ width: '100%', aspectRatio: '16 / 9' }}
        onTimeUpdate={handleTimeUpdate as never}
        onEnded={handleEnded as never}
      />
    </div>
  );
}
