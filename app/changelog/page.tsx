import changelog from '@/content/changelog.json';

type Entry = {
  date: string;
  title: string;
  summary: string;
  tags?: string[];
  commit?: string;
  prUrl?: string;
};

const TAG_COLORS: Record<string, string> = {
  developer: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
  arcade: 'bg-purple-500/15 text-purple-300 border-purple-400/30',
  learn: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  store: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  fix: 'bg-red-500/15 text-red-300 border-red-400/30',
  infra: 'bg-white/10 text-white/70 border-white/20',
};

function tagClass(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-white/10 text-white/70 border-white/20';
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function groupByMonth(entries: Entry[]): Array<{ key: string; label: string; items: Entry[] }> {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    const bucket = groups.get(key) ?? [];
    bucket.push(e);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => {
      const d = new Date(key + '-01T00:00:00Z');
      const label = d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
      return { key, label, items };
    });
}

export default function ChangelogPage() {
  const entries = [...(changelog.entries as Entry[])].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  const groups = groupByMonth(entries);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Changelog</h1>
        <p className="text-white/60 mt-2">What's new across the site, games, and developer platform.</p>
      </div>

      {entries.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
          No entries yet.
        </div>
      )}

      <div className="space-y-12">
        {groups.map((group) => (
          <section key={group.key} className="space-y-4">
            <h2 className="text-sm uppercase tracking-widest text-white/40">{group.label}</h2>
            <ul className="space-y-4">
              {group.items.map((entry, i) => (
                <li
                  key={`${entry.date}-${i}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3"
                >
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <h3 className="text-lg font-semibold">{entry.title}</h3>
                    <time className="text-xs text-white/40 font-mono">{formatDate(entry.date)}</time>
                  </div>
                  <p className="text-white/75 leading-relaxed">{entry.summary}</p>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {(entry.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className={`text-xs px-2 py-0.5 rounded border ${tagClass(tag)}`}
                      >
                        {tag}
                      </span>
                    ))}
                    {entry.commit && (
                      <a
                        href={`https://github.com/Luzzotica/arcade/commit/${entry.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-white/40 hover:text-white/80 font-mono ml-auto"
                      >
                        {entry.commit.slice(0, 7)} ↗
                      </a>
                    )}
                    {entry.prUrl && (
                      <a
                        href={entry.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-white/40 hover:text-white/80"
                      >
                        PR ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
