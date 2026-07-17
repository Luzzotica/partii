"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type StudioProject = {
  id: string;
  name: string;
  slug: string;
};

const SECTIONS = ["tasks", "overview", "players", "settings", "usage"] as const;
type Section = (typeof SECTIONS)[number];

const TABS: { slug: Section; label: string }[] = [
  { slug: "tasks", label: "Tasks" },
  { slug: "overview", label: "Overview" },
  { slug: "players", label: "Players" },
  { slug: "settings", label: "Settings" },
  { slug: "usage", label: "Usage" },
];

const LAST_PROJECT_COOKIE = "partii_last_project";

function parseProjectRoute(pathname: string): { projectId: string | null; section: Section } {
  const parts = pathname.split("/").filter(Boolean);
  // /developer/projects/:id/:section?
  const idx = parts.indexOf("projects");
  if (idx >= 0 && parts[idx + 1] && parts[idx + 1] !== "manage") {
    const id = parts[idx + 1];
    const sec = parts[idx + 2];
    if (sec && (SECTIONS as readonly string[]).includes(sec)) {
      return { projectId: id, section: sec as Section };
    }
    return { projectId: id, section: "tasks" };
  }
  return { projectId: null, section: "tasks" };
}

function setLastProjectCookie(id: string) {
  try {
    document.cookie = `${LAST_PROJECT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch { /* ignore */ }
}

export function StudioHeader({
  projects,
  taskBadges = {},
}: {
  projects: StudioProject[];
  /** open task count / inbox per project id */
  taskBadges?: Record<string, { open: number; inbox: number }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { projectId, section } = parseProjectRoute(pathname);
  const current = projects.find((p) => p.id === projectId) ?? null;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (current) setLastProjectCookie(current.id);
  }, [current]);

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

  const goProject = (id: string) => {
    setOpen(false);
    setLastProjectCookie(id);
    router.push(`/developer/projects/${id}/${section}`);
  };

  const badge = current ? taskBadges[current.id] : null;

  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      {/* Project switcher */}
      {projects.length > 0 && (
        <div ref={rootRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 hover:bg-white/[0.08] transition-colors max-w-[200px] sm:max-w-[240px]"
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <span className="min-w-0 text-left">
              <span className="block text-sm font-medium text-white truncate">
                {current?.name ?? "Select project"}
              </span>
              {current && (
                <span className="block text-[11px] font-mono text-white/45 truncate">{current.slug}</span>
              )}
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
                  const active = p.id === current?.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => goProject(p.id)}
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
                  href="/developer/manage"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/[0.06]"
                >
                  Manage projects
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section tabs — only inside a project */}
      {current && (
        <nav className="flex items-center gap-0.5 overflow-x-auto min-w-0" aria-label="Project sections">
          {TABS.map((tab) => {
            const href = `/developer/projects/${current.id}/${tab.slug}`;
            const active = section === tab.slug;
            const showBadge =
              tab.slug === "tasks" && badge && (badge.open > 0 || badge.inbox > 0);
            return (
              <Link
                key={tab.slug}
                href={href}
                className={`relative shrink-0 px-2.5 sm:px-3 py-1.5 text-sm rounded-md transition-colors ${
                  active
                    ? "text-white bg-white/10"
                    : "text-white/55 hover:text-white/85 hover:bg-white/[0.04]"
                }`}
              >
                {tab.label}
                {showBadge && (
                  <span className="ml-1 text-[10px] tabular-nums text-white/45">
                    {badge.open}
                    {badge.inbox > 0 && (
                      <span className="ml-1 rounded bg-yellow-300/15 text-yellow-200 px-1 py-px">
                        {badge.inbox}
                      </span>
                    )}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
