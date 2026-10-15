// The developer dashboard (/dev): players, sessions, retention, events and
// funnels, and error reports for your games (src/api/analytics.ts on the
// edge). Signs in with a developer token (`partii tokens create`), kept for
// this tab only unless "remember" is ticked.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, PartiiError } from "../../../sdk/ts/src/client";

type Dev = ReturnType<typeof createClient>;
type Filters = { days: number; platform: string; version: string; owned: string };
type Breakdown = { k: string; n: number }[];

const TOKEN_KEY = "partii.dev-token";

function savedToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveToken(t: string, remember: boolean) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch {
    /* private mode: this page only */
  }
}

export const message = (e: unknown) => (e instanceof PartiiError ? `${e.message}${e.hint ? ` (${e.hint})` : ""}` : String(e));
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
export const secs = (s: number | null) => (s === null ? "–" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Bars per day; `parts` stack (bottom first). */
export function DayBars({ days, parts, label }: { days: { day: string }[]; parts: { key: string; className: string; name: string }[]; label: string }) {
  const totals = days.map((d: any) => parts.reduce((a, p) => a + (d[p.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const w = 100 / Math.max(days.length, 1);
  return (
    <figure className="chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
        {days.map((d: any, i) => {
          let y = 40;
          return parts.map((p) => {
            const h = ((d[p.key] ?? 0) / max) * 38;
            y -= h;
            return (
              <rect key={`${i}-${p.key}`} className={p.className} x={i * w + w * 0.12} width={w * 0.76} y={y} height={h}>
                <title>{`${d.day}: ${parts.map((q) => `${d[q.key] ?? 0} ${q.name}`).join(", ")}`}</title>
              </rect>
            );
          });
        })}
      </svg>
      <figcaption>
        <span>{days[0]?.day}</span>
        <span className="legend">
          {parts.map((p) => (
            <span key={p.key}>
              <i className={p.className} /> {p.name}
            </span>
          ))}
          <span className="muted">max {max}</span>
        </span>
        <span>{days[days.length - 1]?.day}</span>
      </figcaption>
    </figure>
  );
}

export function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub muted">{sub}</div>}
    </div>
  );
}

function Players({ dev, game, f, onBreakdowns }: { dev: Dev; game: string; f: Filters; onBreakdowns: (b: { platforms: Breakdown; versions: Breakdown }) => void }) {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    // A reply for an earlier game or filter is dropped.
    let live = true;
    setS(null);
    dev
      .analyticsSummary(game, { days: f.days, platform: f.platform || undefined, version: f.version || undefined, owned: f.owned || undefined })
      .then((r) => live && (setS(r), onBreakdowns({ platforms: r.platforms, versions: r.versions })), (e) => live && setErr(message(e)));
    return () => void (live = false);
  }, [dev, game, f.days, f.platform, f.version, f.owned]);
  if (err) return <p className="note">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const r = s.retention;
  return (
    <section>
      <div className="tiles">
        <Tile label={`Players, ${f.days} days`} value={s.players} />
        <Tile label="Today" value={s.dau} sub="daily players" />
        <Tile label="Last 7 days" value={s.wau} />
        <Tile label="Last 30 days" value={s.mau} />
        <Tile label="Sessions" value={s.sessions} sub={`median ${secs(s.median_session_secs)}`} />
        <Tile label="Day 1 back" value={pct(r.d1.rate)} sub={`of ${r.d1.cohort}`} />
        <Tile label="Day 7 back" value={pct(r.d7.rate)} sub={`of ${r.d7.cohort}`} />
        <Tile label="Day 30 back" value={pct(r.d30.rate)} sub={`of ${r.d30.cohort}`} />
      </div>
      <h3>Players per day</h3>
      <DayBars days={s.days} label="players per day" parts={[{ key: "returning", className: "c1", name: "returning" }, { key: "new", className: "c2", name: "new" }]} />
      <h3>Sessions per day</h3>
      <DayBars days={s.days} label="sessions per day" parts={[{ key: "sessions", className: "c1", name: "sessions" }]} />
      <div className="cols">
        {(["platforms", "versions", "countries"] as const).map((k) => (
          <div key={k}>
            <h3>{k[0].toUpperCase() + k.slice(1)}</h3>
            <table>
              <tbody>
                {(s[k] as Breakdown).map((x) => (
                  <tr key={x.k}>
                    <td>{x.k || <span className="muted">unknown</span>}</td>
                    <td className="num">{x.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="muted small">
        Retention: of the players first seen in this range (early enough to have had that day), the share who played again exactly 1, 7 or 30 days later.
      </p>
    </section>
  );
}

function Events({ dev, game, f }: { dev: Dev; game: string; f: Filters }) {
  const q = { days: f.days, platform: f.platform || undefined, version: f.version || undefined, owned: f.owned || undefined };
  const [names, setNames] = useState<{ name: string; n: number; devices: number }[] | null>(null);
  const [name, setName] = useState("");
  const [by, setBy] = useState("");
  const [byInput, setByInput] = useState("");
  useEffect(() => (setName(""), setBy(""), setByInput("")), [game]);
  const [series, setSeries] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setNames(null);
    dev.analyticsEvents(game, q).then((r) => live && setNames(r.names), (e) => live && setErr(message(e)));
    return () => void (live = false);
  }, [dev, game, f.days, f.platform, f.version, f.owned]);
  useEffect(() => {
    if (!name) return setSeries(null);
    let live = true;
    setSeries(null);
    dev.analyticsEvents(game, { ...q, name, by: by || undefined } as any).then((r) => live && setSeries(r), (e) => live && setErr(message(e)));
    return () => void (live = false);
  }, [dev, game, name, by, f.days, f.platform, f.version, f.owned]);
  if (err) return <p className="note">{err}</p>;
  if (!names) return <p className="muted">Loading…</p>;
  if (!names.length) return <p className="muted">No events in this range. Games send them with the account crate's <code>track</code>.</p>;
  const first = series?.values?.[0]?.devices || 1;
  return (
    <section className="split">
      <table className="pick">
        <thead>
          <tr>
            <th>Event</th>
            <th className="num">Count</th>
            <th className="num">Players</th>
          </tr>
        </thead>
        <tbody>
          {names.map((x) => (
            <tr key={x.name} className={x.name === name ? "on" : ""} onClick={() => (setName(x.name), setBy(""), setByInput(""))}>
              <td>{x.name}</td>
              <td className="num">{x.n}</td>
              <td className="num">{x.devices}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        {!name && <p className="muted">Pick an event.</p>}
        {name && (
          <form className="row" onSubmit={(e) => (e.preventDefault(), setBy(byInput.trim()))}>
            <b>{name}</b>
            <span className="muted">by</span>
            <input placeholder="a prop (mission) or platform, version, build, owned" value={byInput} onChange={(e) => setByInput(e.target.value)} />
            <button>Show</button>
            {by && (
              <button type="button" className="secondary" onClick={() => (setBy(""), setByInput(""))}>
                Per day
              </button>
            )}
          </form>
        )}
        {name && !series && <p className="muted">Loading…</p>}
        {series?.days && (
          <>
            <p className="muted">{series.total} in this range</p>
            <DayBars days={series.days} label={`${name} per day`} parts={[{ key: "n", className: "c1", name: "count" }]} />
          </>
        )}
        {series?.values && (
          <table className="funnel">
            <thead>
              <tr>
                <th>{by}</th>
                <th className="num">Count</th>
                <th className="num">Players</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {series.values.map((v: any) => (
                <tr key={String(v.value)}>
                  <td>{v.value === null ? <span className="muted">none</span> : String(v.value)}</td>
                  <td className="num">{v.n}</td>
                  <td className="num">{v.devices}</td>
                  <td className="bar-cell">
                    <span className="bar" style={{ width: `${Math.min(100, (v.devices / first) * 100)}%` }} />
                    <span className="muted small">{Math.round((v.devices / first) * 100)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Errors({ dev, game, f }: { dev: Dev; game: string; f: Filters }) {
  const [status, setStatus] = useState("open");
  const [groups, setGroups] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    let live = true;
    dev.errorsList(game, { status, version: f.version || undefined, platform: f.platform || undefined }).then((r) => live && setGroups(r.groups), (e) => live && setErr(message(e)));
    return () => void (live = false);
  }, [dev, game, status, f.version, f.platform]);
  useEffect(load, [load]);
  const show = (fp: string) => dev.errorsGet(game, fp).then(setOpen, (e) => setErr(message(e)));
  const mark = async (fp: string, s: string) => {
    await dev.errorsUpdate(game, fp, { status: s }).catch((e) => setErr(message(e)));
    setOpen(null);
    load();
  };
  if (err) return <p className="note">{err}</p>;
  return (
    <section>
      <div className="row">
        {["open", "fixed", "ignored", "all"].map((s) => (
          <button key={s} className={s === status ? "" : "secondary"} onClick={() => (setStatus(s), setOpen(null))}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {!groups && <p className="muted">Loading…</p>}
      {groups && !groups.length && <p className="muted">No {status === "all" ? "" : status} errors. Games report them with the account crate's <code>report_error</code> and <code>install_panic_hook</code>.</p>}
      {groups && groups.length > 0 && (
        <table className="pick errors">
          <thead>
            <tr>
              <th>Error</th>
              <th className="num">Reports</th>
              <th className="num">Players</th>
              <th>Versions</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.fingerprint} className={open?.group.fingerprint === g.fingerprint ? "on" : ""} onClick={() => show(g.fingerprint)}>
                <td>
                  <span className={`kind ${g.kind}`}>{g.kind}</span> {g.message.slice(0, 140)}
                  {g.top_frame && <div className="muted small mono">{g.top_frame}</div>}
                </td>
                <td className="num">{g.count}</td>
                <td className="num">{g.devices}</td>
                <td className="small">{g.versions.join(", ")}</td>
                <td className="small">{ago(g.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="detail">
          <div className="row">
            <h3>
              <span className={`kind ${open.group.kind}`}>{open.group.kind}</span> {open.group.status}
            </h3>
            <span className="spacer" />
            {open.group.status !== "fixed" && <button onClick={() => mark(open.group.fingerprint, "fixed")}>Mark fixed</button>}
            {open.group.status !== "ignored" && (
              <button className="secondary" onClick={() => mark(open.group.fingerprint, "ignored")}>
                Ignore
              </button>
            )}
            {open.group.status !== "open" && (
              <button className="secondary" onClick={() => mark(open.group.fingerprint, "open")}>
                Reopen
              </button>
            )}
          </div>
          <p className="mono">{open.group.message}</p>
          <p className="muted small">
            First seen {new Date(open.group.first_seen).toLocaleString()} · {open.group.platforms.join(", ")} · fixed bugs reopen when they're reported again
          </p>
          {open.samples.map((s: any, i: number) => (
            <details key={i} open={i === 0}>
              <summary>
                {new Date(s.at).toLocaleString()} · {s.platform} {s.version} {s.build} {s.player ? "· signed in" : ""}
              </summary>
              {Object.keys(s.context).length > 0 && <p className="mono small">{JSON.stringify(s.context)}</p>}
              {s.backtrace && <pre>{s.backtrace}</pre>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export function DevDashboard({ api }: { api: string }) {
  const [token, setToken] = useState(savedToken);
  const [input, setInput] = useState("");
  const [remember, setRemember] = useState(false);
  const dev = useMemo(() => createClient({ base: api, developerToken: token }), [api, token]);
  const [games, setGames] = useState<{ id: string; title: string }[] | null>(null);
  const [err, setErr] = useState("");
  const [game, setGame] = useState("");
  const [tab, setTab] = useState<"players" | "events" | "errors">("players");
  const [f, setF] = useState<Filters>({ days: 30, platform: "", version: "", owned: "" });
  const [choices, setChoices] = useState<{ platforms: Breakdown; versions: Breakdown }>({ platforms: [], versions: [] });
  useEffect(() => {
    if (!token) return;
    setErr("");
    dev.gamesList().then(
      (r) => {
        setGames(r.games);
        setGame((g) => g || r.games[0]?.id || "");
      },
      (e) => {
        setErr(message(e));
        setGames(null);
      },
    );
  }, [dev, token]);

  if (!token || (err && !games)) {
    return (
      <form className="signin" onSubmit={(e) => (e.preventDefault(), saveToken(input.trim(), remember), setToken(input.trim()))}>
        <h1>Developer dashboard</h1>
        <p className="muted">Players, sessions, retention, events and errors for your games. Paste a developer token (make one with <code>partii tokens create</code>).</p>
        <input type="password" placeholder="pd_…" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this browser
        </label>
        <button>Open</button>
        {err && <p className="note">{err}</p>}
      </form>
    );
  }
  if (!games) return <p className="muted">Loading…</p>;
  const set = (k: keyof Filters, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="dev">
      <div className="row">
        <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="game">
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title} ({g.id})
            </option>
          ))}
        </select>
        <select value={f.days} onChange={(e) => set("days", Number(e.target.value))} aria-label="range">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <select value={f.platform} onChange={(e) => set("platform", e.target.value)} aria-label="platform">
          <option value="">All platforms</option>
          {choices.platforms.filter((p) => p.k).map((p) => (
            <option key={p.k}>{p.k}</option>
          ))}
        </select>
        <select value={f.version} onChange={(e) => set("version", e.target.value)} aria-label="version">
          <option value="">All versions</option>
          {choices.versions.filter((p) => p.k).map((p) => (
            <option key={p.k}>{p.k}</option>
          ))}
        </select>
        <select value={f.owned} onChange={(e) => set("owned", e.target.value)} aria-label="demo or full">
          <option value="">Demo and full</option>
          <option value="true">Full game</option>
          <option value="false">Demo</option>
        </select>
        <span className="spacer" />
        <button className="secondary" onClick={() => (saveToken("", false), setToken(""), setGames(null))}>
          Sign out
        </button>
      </div>
      <div className="tabs">
        {(["players", "events", "errors"] as const).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {!game && <p className="muted">No games yet.</p>}
      {game && tab === "players" && <Players dev={dev} game={game} f={f} onBreakdowns={setChoices} />}
      {game && tab === "events" && <Events dev={dev} game={game} f={f} />}
      {game && tab === "errors" && <Errors dev={dev} game={game} f={f} />}
    </div>
  );
}
