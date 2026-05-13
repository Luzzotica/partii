import type { Lesson, LessonProgress } from './types';

export function isLessonComplete(
  lesson: Pick<Lesson, 'mux_playback_id'>,
  progress: Pick<LessonProgress, 'completed' | 'watch_percent'> | undefined
): boolean {
  if (!progress) return false;
  if (progress.completed) return true;
  if (lesson.mux_playback_id && progress.watch_percent >= 90) return true;
  return false;
}

export function computeCoursePercent(
  lessons: Array<Pick<Lesson, 'id' | 'mux_playback_id'>>,
  progressByLessonId: Map<string, Pick<LessonProgress, 'completed' | 'watch_percent'>>
): number {
  if (lessons.length === 0) return 0;
  const done = lessons.filter((l) => isLessonComplete(l, progressByLessonId.get(l.id))).length;
  return Math.round((done / lessons.length) * 100);
}
