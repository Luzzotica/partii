"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type SwitcherProject = {
  id: string;
  name: string;
  slug: string;
};

const SECTIONS = ["tasks", "overview", "players", "settings"] as const;

function sectionFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  // /developer/projects/:id/:section?
  const idx = parts.indexOf("projects");
  if (idx >= 0 && parts[idx + 2] && SECTIONS.includes(parts[idx + 2] as (typeof SECTIONS)[number])) {
    return parts[idx + 2];
  }
  return "tasks";
}

export function ProjectSwitcher({
  current,
  projects,
}: {
  current: SwitcherProject;
  projects: SwitcherProject[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const section = sectionFromPath(pathname);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    if (id === current.id) return;
    router.push(`/developer/projects/${id}/${section}`);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 hover:bg-white/[0.08] transition-colors max-w-[240px]"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 text-left">
          <span className="block text-sm font-medium text-white truncate">{current.name}</span>
          <span className="block text-[11px] font-mono text-white/45 truncate">{current.slug}</span>
        </span>
        <span className="text-white/40 text-xs shrink-0" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-white/10 bg-[#12122a] shadow-xl shadow-black/40 overflow-hidden"
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {projects.map((p) => {
              const active = p.id === current.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => go(p.id)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-white/[0.06] transition-colors ${
                    active ? "bg-white/[0.08]" : ""
                  }`}
                >
                  <span className="block text-sm text-white/90 truncate">{p.name}</span>
                  <span className="block text-[11px] font-mono text-white/40 truncate">{p.slug}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-white/10 p-1">
            <Link
              href="/developer"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/[0.06]"
            >
              All projects
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
