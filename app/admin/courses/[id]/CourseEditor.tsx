'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Course, CourseModule } from '@/lib/learn/types';
import { CoverImageUploader } from '@/components/admin/CoverImageUploader';

type LessonRow = {
  id: string;
  module_id: string;
  title: string;
  position: number;
  mux_playback_id: string | null;
};

type Props = {
  course: Course;
  modules: CourseModule[];
  lessons: LessonRow[];
};

export function CourseEditor({ course, modules, lessons }: Props) {
  const router = useRouter();
  const [meta, setMeta] = useState({
    title: course.title,
    slug: course.slug,
    subtitle: course.subtitle ?? '',
    description: course.description ?? '',
    cover_image_url: course.cover_image_url ?? '',
    is_published: course.is_published,
    is_free: course.is_free,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function saveMeta() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/admin/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...meta,
        cover_image_url: meta.cover_image_url || null,
      }),
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

  async function deleteCourse() {
    if (!confirm(`Delete "${course.title}" and all its content? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/courses/${course.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/admin/courses');
  }

  async function addModule() {
    const title = prompt('Module title');
    if (!title) return;
    const res = await fetch('/api/admin/modules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ course_id: course.id, title }),
    });
    if (res.ok) router.refresh();
  }

  async function renameModule(m: CourseModule) {
    const title = prompt('Module title', m.title);
    if (!title || title === m.title) return;
    await fetch(`/api/admin/modules/${m.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    router.refresh();
  }

  async function deleteModule(m: CourseModule) {
    if (!confirm(`Delete module "${m.title}" and all its lessons?`)) return;
    await fetch(`/api/admin/modules/${m.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function addLesson(moduleId: string) {
    const title = prompt('Lesson title');
    if (!title) return;
    const res = await fetch('/api/admin/lessons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ module_id: moduleId, title }),
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/admin/courses/${course.id}/lessons/${data.lesson.id}`);
    }
  }

  return (
    <div className="space-y-8">
      {/* Course meta */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Course details</h2>
          <button onClick={deleteCourse} className="text-xs text-red-400 hover:underline">
            Delete course
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Title">
            <input
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
            />
          </Field>
          <Field label="Slug">
            <input
              value={meta.slug}
              onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono"
            />
          </Field>
          <Field label="Subtitle">
            <input
              value={meta.subtitle}
              onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
            />
          </Field>
          <Field label="Cover image" className="sm:col-span-2">
            <CoverImageUploader
              value={meta.cover_image_url}
              onChange={(url) => setMeta({ ...meta, cover_image_url: url })}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea
              value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
            />
          </Field>
          <div className="flex items-end gap-6">
            <Toggle
              label="Published"
              value={meta.is_published}
              onChange={(v) => setMeta({ ...meta, is_published: v })}
            />
            <Toggle
              label="Free enrollment"
              value={meta.is_free}
              onChange={(v) => setMeta({ ...meta, is_free: v })}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveMeta}
            disabled={saving}
            className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          {msg && <span className="text-sm text-white/60">{msg}</span>}
        </div>
      </section>

      {/* Modules + lessons */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Curriculum</h2>
          <button
            onClick={addModule}
            className="px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5"
          >
            + Add module
          </button>
        </div>

        {modules.length === 0 && (
          <p className="text-sm text-white/40">No modules yet. Add one to start building.</p>
        )}

        {modules.map((m) => {
          const moduleLessons = lessons.filter((l) => l.module_id === m.id);
          return (
            <div key={m.id} className="rounded-xl border border-white/10 bg-white/5">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/40 font-mono">#{m.position + 1}</span>
                  <span className="font-medium">{m.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button onClick={() => renameModule(m)} className="text-white/60 hover:text-white">
                    Rename
                  </button>
                  <button onClick={() => deleteModule(m)} className="text-red-400 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
              <ul>
                {moduleLessons.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between px-4 py-2 border-b border-white/5 last:border-0 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/40 font-mono">{l.position + 1}.</span>
                      <span>{l.title}</span>
                      {l.mux_playback_id && (
                        <span className="text-[0.65rem] uppercase tracking-wider bg-white/10 text-white/60 px-1.5 py-0.5 rounded">
                          Video
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/admin/courses/${course.id}/lessons/${l.id}`}
                      className="text-[#5a67fa] hover:underline"
                    >
                      Edit
                    </Link>
                  </li>
                ))}
                <li className="px-4 py-2">
                  <button
                    onClick={() => addLesson(m.id)}
                    className="text-sm text-white/60 hover:text-white"
                  >
                    + Add lesson
                  </button>
                </li>
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs uppercase tracking-wider text-white/50 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      {label}
    </label>
  );
}
