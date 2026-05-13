'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Offer } from '@/lib/learn/types';
import { CoverImageUploader } from '@/components/admin/CoverImageUploader';

type CourseOption = { id: string; slug: string; title: string };

type Props = {
  offer: Offer;
  linkedCourseIds: string[];
  allCourses: CourseOption[];
};

export function OfferEditor({ offer, linkedCourseIds, allCourses }: Props) {
  const router = useRouter();
  const [meta, setMeta] = useState({
    name: offer.name,
    slug: offer.slug,
    description: offer.description ?? '',
    price_dollars: (offer.price_cents / 100).toFixed(2),
    currency: offer.currency,
    cover_image_url: offer.cover_image_url ?? '',
    is_published: offer.is_published,
  });
  const [linked, setLinked] = useState<Set<string>>(new Set(linkedCourseIds));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  async function saveMeta() {
    setSaving(true);
    setMsg(null);
    setWarn(null);
    const dollars = parseFloat(meta.price_dollars || '0');
    const price_cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    const res = await fetch(`/api/admin/offers/${offer.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: meta.name,
        slug: meta.slug,
        description: meta.description || null,
        price_cents,
        currency: meta.currency,
        cover_image_url: meta.cover_image_url || null,
        is_published: meta.is_published,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg(data.error ?? 'Failed');
      return;
    }
    setMsg('Saved');
    if (data.stripe_warning) setWarn(`Stripe sync: ${data.stripe_warning}`);
    router.refresh();
  }

  async function toggleCourse(courseId: string) {
    if (linked.has(courseId)) {
      const res = await fetch(
        `/api/admin/offers/${offer.id}/courses?course_id=${encodeURIComponent(courseId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        const next = new Set(linked);
        next.delete(courseId);
        setLinked(next);
      }
    } else {
      const res = await fetch(`/api/admin/offers/${offer.id}/courses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ course_id: courseId }),
      });
      if (res.ok) {
        const next = new Set(linked);
        next.add(courseId);
        setLinked(next);
      }
    }
    router.refresh();
  }

  async function deleteOffer() {
    if (!confirm(`Delete offer "${offer.name}"? This will archive it in Stripe.`)) return;
    const res = await fetch(`/api/admin/offers/${offer.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/admin/offers');
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Offer details</h2>
          <button onClick={deleteOffer} className="text-xs text-red-400 hover:underline">
            Delete offer
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
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
          <Field label="Price">
            <input
              type="number"
              step="0.01"
              min="0"
              value={meta.price_dollars}
              onChange={(e) => setMeta({ ...meta, price_dollars: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
            />
          </Field>
          <Field label="Currency">
            <input
              value={meta.currency}
              onChange={(e) => setMeta({ ...meta, currency: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono uppercase"
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
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={meta.is_published}
              onChange={(e) => setMeta({ ...meta, is_published: e.target.checked })}
              className="w-4 h-4"
            />
            Published
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveMeta}
            disabled={saving}
            className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & sync Stripe'}
          </button>
          {msg && <span className="text-sm text-white/60">{msg}</span>}
          {warn && <span className="text-sm text-amber-400">{warn}</span>}
        </div>
        <div className="text-xs text-white/40 font-mono space-y-0.5">
          <div>stripe_product_id: {offer.stripe_product_id ?? '—'}</div>
          <div>stripe_price_id: {offer.stripe_price_id ?? '—'}</div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
        <h2 className="text-lg font-semibold">Courses included</h2>
        <p className="text-sm text-white/60">
          Buying this offer will enroll the user in every course checked below.
        </p>
        {allCourses.length === 0 && (
          <p className="text-sm text-white/40">No courses exist yet. Create some first.</p>
        )}
        <ul className="space-y-1">
          {allCourses.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={linked.has(c.id)}
                  onChange={() => toggleCourse(c.id)}
                  className="w-4 h-4"
                />
                <span>{c.title}</span>
                <span className="text-xs text-white/40 font-mono">{c.slug}</span>
              </label>
            </li>
          ))}
        </ul>
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
