'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type CourseOpt = { id: string; title: string };

export function BroadcastForm({ courses }: { courses: CourseOpt[] }) {
  const router = useRouter();
  const [courseId, setCourseId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('Send this broadcast to everyone enrolled in the selected course?')) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/admin/broadcasts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        course_id: courseId,
        subject,
        body_html: body,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? 'Failed');
      return;
    }
    setMsg(`Sent ${data.sent} / failed ${data.failed} (of ${data.recipients} enrolled)`);
    setSubject('');
    setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={send} className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
      <Field label="Course">
        <select
          required
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
        >
          <option value="">Choose course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </Field>
      <Field label="Subject">
        <input
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
        />
      </Field>
      <Field label="Body (HTML)">
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono"
          placeholder="<p>Hi everyone,</p>"
        />
      </Field>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !courseId}
          className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send broadcast'}
        </button>
        {msg && <span className="text-sm text-white/70">{msg}</span>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-white/50 mb-1">{label}</span>
      {children}
    </label>
  );
}
