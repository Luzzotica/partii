"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "tasks", label: "Tasks" },
  { slug: "overview", label: "Overview" },
  { slug: "players", label: "Players" },
  { slug: "settings", label: "Settings" },
] as const;

export function ProjectNav({
  projectId,
  taskBadge,
}: {
  projectId: string;
  taskBadge?: { open: number; inbox: number } | null;
}) {
  const pathname = usePathname();
  const base = `/developer/projects/${projectId}`;

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Project sections">
      {TABS.map((tab) => {
        const href = `${base}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const showBadge =
          tab.slug === "tasks" &&
          taskBadge &&
          (taskBadge.open > 0 || taskBadge.inbox > 0);

        return (
          <Link
            key={tab.slug}
            href={href}
            className={`relative shrink-0 px-3 py-2 text-sm transition-colors border-b-2 ${
              active
                ? "text-white border-white"
                : "text-white/55 border-transparent hover:text-white/85"
            }`}
          >
            {tab.label}
            {showBadge && (
              <span className="ml-1.5 text-[10px] tabular-nums text-white/45">
                {taskBadge.open}
                {taskBadge.inbox > 0 && (
                  <span className="ml-1 rounded bg-yellow-300/15 text-yellow-200 px-1 py-px">
                    {taskBadge.inbox}
                  </span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
