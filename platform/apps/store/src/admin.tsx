// The operator's page (/admin): all of partii at once (players, sessions,
// play time, errors and sales for every game; daily totals; the store site's
// pages and referrers), the review queue for new developers' games, and the
// developers. Signs in with the platform admin token, kept for this tab only
// unless "remember" is ticked. Everything here is also in the CLI:
// partii admin overview / games review / games decide / developers list / trust.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../../sdk/ts/src/client";
import { DayBars, message, secs, Tile } from "./dev";

const TOKEN_KEY = "partii.admin-token";
const read = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const write = (t: string, remember: boolean) => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch {
    /* this page only */
  }
};

const money = (c: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(c / 100);
const hours = (s: number) => (s < 5400 ? secs(s) : `${Math.round(s / 3600)} h`);

type GameRow = {
  id: string;
  title: string;
  status: string;
  review: { status: string; note: string } | null;
  developer: { email: string; name: string; trusted: boolean };
  dau: number;
  wau: number;
  mau: number;
  new_players: number;
  sessions: number;
  play_secs: number;
  avg_session_secs: number | null;
  errors_open: number;
  errors_recent: number;
  purchases: number;
  revenue_cents: number;
  last_active: string | null;
};

const COLUMNS: { key: keyof GameRow; label: string; fmt?: (g: GameRow) => string | number }[] = [
  { key: "dau", label: "Today" },
  { key: "wau", label: "7 days" },
  { key: "mau", label: "30 days" },
  { key: "new_players", label: "New" },
  { key: "sessions", label: "Sessions" },
  { key: "play_secs", label: "Play time", fmt: (g) => hours(g.play_secs) },
  { key: "avg_session_secs", label: "Avg session", fmt: (g) => secs(g.avg_session_secs) },
  { key: "errors_open", label: "Open errors", fmt: (g) => (g.errors_open ? `${g.errors_open}${g.errors_recent ? ` (${g.errors_recent} new)` : ""}` : "–") },
  { key: "revenue_cents", label: "Sales", fmt: (g) => (g.purchases ? `${money(g.revenue_cents)} · ${g.purchases}` : "–") },
  { key: "last_active", label: "Last played", fmt: (g) => g.last_active ?? "–" },
];

function Status({ g }: { g: { status: string; review: GameRow["review"] } }) {
  const r = g.review?.status;
  const label = r === "pending" ? "in review" : r === "rejected" ? "rejected" : g.status;
  return <span className={`badge ${label.replace(" ", "-")}`}>{label}</span>;
}

function Overview({ admin }: { admin: ReturnType<typeof createClient> }) {
  const [days, setDays] = useState(7);
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<keyof GameRow>("wau");
  useEffect(() => {
    let live = true;
    setO(null);
    admin.adminOverview({ days }).then((r) => live && setO(r), (e) => live && setErr(message(e)));
    return () => void (live = false);
  }, [admin, days]);
  if (err) return <p className="note">{err}</p>;
  if (!o) return <p className="muted">Loading…</p>;
  const t = o.totals;
  const games: GameRow[] = [...o.games].sort((a, b) => (Number(b[sort] ?? 0) || 0) - (Number(a[sort] ?? 0) || 0) || a.id.localeCompare(b.id));
  return (
    <section>
      <div className="row">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="range">
          {[1, 7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {d === 1 ? "Today" : `Last ${d} days`}
            </option>
          ))}
        </select>
        <span className="muted small">
          {o.range.from} to {o.range.to}
        </span>
      </div>
      <div className="tiles">
        <Tile label="Players today" value={t.players_today} sub="across games" />
        <Tile label="Sessions" value={t.sessions} />
        <Tile label="Play time" value={hours(t.play_secs)} />
        <Tile label="Sales" value={money(t.revenue_cents)} sub={`${t.purchases} purchases`} />
        <Tile label="Open errors" value={t.errors_open} />
        <Tile label="Games" value={t.games} sub={`${t.published} on the store, ${t.in_review} in review`} />
        <Tile label="Developers" value={t.developers} sub={`${t.developers_new} new, ${t.developers_untrusted} not yet trusted`} />
      </div>
      <h3>Players per day, all games</h3>
      <DayBars days={o.daily} label="players per day" parts={[{ key: "players", className: "c1", name: "players" }]} />
      <h3>Play time per day</h3>
      <DayBars days={o.daily.map((d: any) => ({ ...d, minutes: Math.round(d.play_secs / 6) / 10 }))} label="minutes played per day" parts={[{ key: "minutes", className: "c2", name: "minutes played" }]} />
      <h3>Games</h3>
      <div className="scroll">
        <table className="games-table">
          <thead>
            <tr>
              <th>Game</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`num sortable${sort === c.key ? " on" : ""}`} onClick={() => setSort(c.key)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id}>
                <td>
                  <b>{g.title}</b> <Status g={g} />
                  <div className="muted small">
                    {g.id} · {g.developer.email}
                    {!g.developer.trusted && " (new)"}
                  </div>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="num">
                    {c.fmt ? c.fmt(g) : String(g[c.key] ?? "–")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cols">
        <div>
          <h3>partii.games: top pages</h3>
          <table>
            <tbody>
              {o.site.pages.map((p: any) => (
                <tr key={p.k}>
                  <td>{p.k}</td>
                  <td className="num">{p.n}</td>
                  <td className="num muted">{p.devices} visitors</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Where visits come from</h3>
          <table>
            <tbody>
              {o.site.referrers.map((p: any) => (
                <tr key={p.k}>
                  <td>{p.k}</td>
                  <td className="num">{p.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">Details for one game (events, funnels, error backtraces) are on the developer dashboard at /dev.</p>
    </section>
  );
}

function Review({ admin }: { admin: ReturnType<typeof createClient> }) {
  const [games, setGames] = useState<any[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => admin.adminGamesReview({}).then((r) => setGames(r.games), (e) => setErr(message(e))), [admin]);
  useEffect(() => void load(), [load]);
  const decide = async (game: string, verdict: "approve" | "reject") => {
    setErr("");
    try {
      await admin.adminGamesDecide(game, { verdict, note: notes[game] ?? "" });
      await load();
    } catch (e) {
      setErr(message(e));
    }
  };
  if (!games) return <p className="muted">{err || "Loading…"}</p>;
  return (
    <section>
      {err && <p className="note">{err}</p>}
      {!games.length && <p className="muted">Nothing waiting. New developers' games show up here when they publish.</p>}
      {games.map((g) => (
        <div key={g.id} className="review-card">
          <div>
            <b>{g.title}</b> <span className="muted">{g.id}</span>
            <div className="muted small">
              {g.developer.email} · asked {g.review?.at ? new Date(g.review.at).toLocaleString() : "?"} · {g.platforms.join(", ") || "no platforms"} · {g.price_cents ? money(g.price_cents) : "free"}
            </div>
            {g.tagline && <p>{g.tagline}</p>}
            {g.description && <p className="small">{g.description}</p>}
            {g.site_preview ? (
              <a href={g.site_preview} target="_blank" rel="noreferrer">
                Open the site's preview
              </a>
            ) : (
              <span className="muted small">No site deployed.</span>
            )}
          </div>
          <textarea placeholder="Note for the developer (needed to reject)" value={notes[g.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [g.id]: e.target.value }))} />
          <div className="row">
            <button onClick={() => decide(g.id, "approve")}>Approve</button>
            <button className="secondary" onClick={() => decide(g.id, "reject")} disabled={!(notes[g.id] ?? "").trim()}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Developers({ admin }: { admin: ReturnType<typeof createClient> }) {
  const [devs, setDevs] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => admin.adminDevelopersList().then((r) => setDevs(r.developers), (e) => setErr(message(e))), [admin]);
  useEffect(() => void load(), [load]);
  const trust = async (id: string, trusted: boolean) => {
    try {
      await admin.adminDevelopersTrust(id, { trusted });
      await load();
    } catch (e) {
      setErr(message(e));
    }
  };
  if (!devs) return <p className="muted">{err || "Loading…"}</p>;
  return (
    <section className="scroll">
      {err && <p className="note">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>Developer</th>
            <th>Joined</th>
            <th className="num">Projects</th>
            <th className="num">Games</th>
            <th>Trusted</th>
          </tr>
        </thead>
        <tbody>
          {devs.map((d) => (
            <tr key={d.id}>
              <td>
                {d.email}
                <div className="muted small">
                  {d.name || "–"} · {d.signup === "email" ? "signed up" : "added by partii"}
                </div>
              </td>
              <td>{new Date(d.created_at).toISOString().slice(0, 10)}</td>
              <td className="num">{d.projects}</td>
              <td className="num">{d.games}</td>
              <td>
                <label className="check">
                  <input type="checkbox" checked={d.trusted} onChange={(e) => trust(d.id, e.target.checked)} /> {d.trusted ? "publishes directly" : "games reviewed"}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AdminPage({ api }: { api: string }) {
  const [token, setToken] = useState(read);
  const [input, setInput] = useState("");
  const [remember, setRemember] = useState(false);
  const [tab, setTab] = useState<"overview" | "review" | "developers">("overview");
  const [err, setErr] = useState("");
  const admin = useMemo(() => createClient({ base: api, developerToken: token }), [api, token]);
  useEffect(() => {
    if (!token) return;
    setErr("");
    admin.adminGamesReview({}).catch((e) => setErr(message(e)));
  }, [admin, token]);
  if (!token || err) {
    return (
      <form className="signin" onSubmit={(e) => (e.preventDefault(), write(input.trim(), remember), setToken(input.trim()), setErr(""))}>
        <h1>partii admin</h1>
        <p className="muted">Every game's players, sessions and sales, the review queue and developers. Paste the platform admin token.</p>
        <input type="password" placeholder="admin token" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this browser
        </label>
        <button>Open</button>
        {err && <p className="note">{err}</p>}
      </form>
    );
  }
  return (
    <div className="dev admin">
      <div className="row">
        <h1>partii admin</h1>
        <span className="spacer" />
        <button className="secondary" onClick={() => (write("", false), setToken(""))}>
          Sign out
        </button>
      </div>
      <div className="tabs">
        {(["overview", "review", "developers"] as const).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview admin={admin} />}
      {tab === "review" && <Review admin={admin} />}
      {tab === "developers" && <Developers admin={admin} />}
    </div>
  );
}
