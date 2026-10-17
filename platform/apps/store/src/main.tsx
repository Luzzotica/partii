// The partii store: browse games, buy them, download them, see your library.
// Plain React talking to the generated API client, so the same app can ship
// as a downloadable Tauri app later.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, PartiiError } from "../../../sdk/ts/src/client";
import policyText from "../../../docs/CONTENT-POLICY.md?raw";
import privacyText from "../../../docs/PRIVACY.md?raw";
import { AdminPage } from "./admin";
import { DevDashboard } from "./dev";
import { Developers, GameCard, Home, LINKS } from "./home";
import { Markdown } from "./markdown";
import { deviceId, reportError, startTracking, track } from "./track";
import "./style.css";

const API = import.meta.env.VITE_PARTII_API ?? "https://api.partii.games";
const KEY = import.meta.env.VITE_PARTII_KEY ?? "";
const api = createClient({ base: API, key: KEY });
// The saved player before the first render: pages load their data in effects, which run before usePlayer's.
try {
  const saved = JSON.parse(localStorage.getItem("partii.token") ?? "null") as string | null;
  if (saved) api.setPlayerToken(saved);
} catch {
  /* no storage */
}

// ── Tiny router ──
function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = (to: string) => {
    history.pushState(null, "", to);
    setPath(to);
    scrollTo(0, 0);
  };
  return [path, go];
}

// ── The player: a guest per browser, upgradeable with an email code ──
interface Player {
  id: string;
  display_name: string;
  providers: string[];
}

function store<T>(k: string, v?: T): T | null {
  try {
    if (v !== undefined) localStorage.setItem(k, JSON.stringify(v));
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function usePlayer() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const refresh = useCallback(async () => {
    try {
      const r = await api.playersEntitlements({});
      setOwned(new Set(r.entitlements.map((e: any) => e.game)));
    } catch {
      /* signed out */
    }
  }, []);
  useEffect(() => {
    (async () => {
      let token = store<string>("partii.token");
      if (token) api.setPlayerToken(token ?? undefined);
      try {
        if (!token) throw new Error("no token");
        setPlayer((await api.playersMe()).player);
      } catch {
        const r = await api.playersGuest({ device_id: deviceId(), display_name: "Player" });
        token = store<string>("partii.token", r.player_token) ?? r.player_token;
        api.setPlayerToken(token ?? undefined);
        setPlayer(r.player);
      }
      await refresh();
    })().catch(() => {});
  }, [refresh]);
  const signedIn = (token: string, p: Player) => {
    store("partii.token", token);
    api.setPlayerToken(token);
    setPlayer(p);
    refresh();
  };
  return { player, owned, refresh, signedIn };
}

const money = (cents: number, cur = "usd") => (cents === 0 ? "Free" : new Intl.NumberFormat(undefined, { style: "currency", currency: cur.toUpperCase() }).format(cents / 100));

interface Game {
  id: string;
  title: string;
  tagline: string;
  description: string;
  price_cents: number;
  price_now_cents: number;
  currency: string;
  sale: { percent: number; ends_at: number } | null;
  /** The free part (docs/GUIDE.md §4): `free` names what's free, `join_free` means anyone may join an owner's room; other keys are the game's own. */
  demo: { free_levels?: number; free?: string[]; join_free?: boolean } | null;
  platforms: string[];
  store: { cover?: string; screenshots?: string[]; trailer?: string; appstore_url?: string; play_url?: string };
  /** The game's site, to play in the browser. */
  play_url?: string | null;
}

function Price({ g }: { g: Game }) {
  if (g.sale && g.price_now_cents < g.price_cents) {
    return (
      <span className="price">
        <s>{money(g.price_cents, g.currency)}</s> <b>{money(g.price_now_cents, g.currency)}</b> <em>−{g.sale.percent}%</em>
      </span>
    );
  }
  return <span className="price">{money(g.price_now_cents ?? g.price_cents, g.currency)}</span>;
}

function Cover({ g }: { g: Game }) {
  return g.store?.cover ? <img className="cover" src={g.store.cover} alt="" /> : <div className="cover placeholder">{g.title.slice(0, 1)}</div>;
}

function useGames() {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    api.storeGames().then((r) => setGames(r.games), () => setGames([]));
  }, []);
  return games;
}

function AllGames({ go, games }: { go: (to: string) => void; games: Game[] | null }) {
  if (!games) return <p className="muted">Loading…</p>;
  if (!games.length) return <p className="muted">No games yet.</p>;
  return (
    <>
      <h1>Games</h1>
      <div className="grid">
        {games.map((g) => (
          <GameCard key={g.id} g={g} go={go} />
        ))}
      </div>
    </>
  );
}

const PLATFORM_NAMES: Record<string, string> = { macos: "Mac", windows: "Windows", linux: "Linux", ios: "iPhone & iPad", android: "Android", web: "Browser" };

/** A step that failed for the visitor: an event, and an error report when the API never answered (the API reports its own). */
function failed(step: string, game: string, e: unknown) {
  const code = e instanceof PartiiError ? e.code : "network";
  track(`${step}_failed`, { game, code });
  if (!(e instanceof PartiiError)) reportError(`${step} failed: ${e instanceof Error ? e.message : String(e)}`, { context: { step, game } });
}

interface NoteSummary {
  version: string;
  title: string;
  excerpt: string;
  published_at: number;
  url: string;
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** A link inside the app (the store's own pages). */
function Go({ to, go, children, className }: { to: string; go: (to: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <a href={to} className={className} onClick={(e) => (e.preventDefault(), go(to))}>
      {children}
    </a>
  );
}

/** A game's patch notes, newest first. */
function Updates({ id, go }: { id: string; go: (to: string) => void }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = (b?: number) =>
    api.storeNotes(id, b ? { before: b } : {}).then(
      (r) => {
        setTitle(r.game.title);
        setNotes((old) => [...(b ? old ?? [] : []), ...r.notes]);
        setBefore(r.next_before);
      },
      () => setNote("This game is not on the store."),
    );
  useEffect(() => {
    load();
  }, [id]);
  useEffect(() => {
    if (title) document.title = `${title} updates · partii`;
  }, [title]);
  if (!notes) return <p className="muted">{note ?? "Loading…"}</p>;
  return (
    <section className="updates" data-testid="updates">
      <p>
        <Go to={`/games/${id}`} go={go}>
          ← {title}
        </Go>
      </p>
      <h1>{title} updates</h1>
      {!notes.length && <p className="muted">No updates posted yet.</p>}
      {notes.map((n) => (
        <Go key={n.version} to={`/games/${id}/updates/${encodeURIComponent(n.version)}`} go={go} className="card update">
          <h3>{n.title}</h3>
          <p className="muted">
            {n.version} · {day(n.published_at)}
          </p>
          {n.excerpt && <p>{n.excerpt}</p>}
        </Go>
      ))}
      {before && (
        <button className="secondary" onClick={() => load(before)}>
          Older updates
        </button>
      )}
    </section>
  );
}

/** One version's patch notes. */
function Update({ id, version, go }: { id: string; version: string; go: (to: string) => void }) {
  const [data, setData] = useState<{ game: { id: string; title: string }; note: NoteSummary & { markdown: string } } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.storeNote(id, version).then(
      (d) => (setData(d), (document.title = `${d.note.title} · partii`)),
      () => setNote("No notes for this version."),
    );
  }, [id, version]);
  if (!data) return <p className="muted">{note ?? "Loading…"}</p>;
  return (
    <section className="updates" data-testid="update">
      <p>
        <Go to={`/games/${id}/updates`} go={go}>
          ← All {data.game.title} updates
        </Go>
      </p>
      <h1>{data.note.title}</h1>
      <p className="muted">
        {data.game.title} {data.note.version} · {day(data.note.published_at)}
      </p>
      <Markdown text={data.note.markdown} className="policy notes" />
      <p>
        <Go to={`/games/${id}`} className="button" go={go}>
          Get {data.game.title}
        </Go>
      </p>
    </section>
  );
}

interface SteamKey {
  key: string;
  activate_url: string;
  revoked: boolean;
}

/** The player's Steam key for a game they own here: activate it on Steam in one click. */
function SteamKeyBox({ k, game }: { k: SteamKey; game: string }) {
  const [copied, setCopied] = useState(false);
  if (k.revoked) return <p className="muted">Your Steam key for this game was revoked (refunded).</p>;
  return (
    <div className="steam-key" data-testid="steam-key">
      <span className="muted">Steam key</span> <code>{k.key}</code>
      <div className="row">
        <a className="button small" href={k.activate_url} target="_blank" rel="noopener noreferrer" onClick={() => track("steam_key_activate", { game })}>
          Activate on Steam
        </a>
        <button
          className="secondary small"
          onClick={() => {
            navigator.clipboard?.writeText(k.key).then(() => setCopied(true), () => {});
            track("steam_key_copy", { game });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function GamePage({ id, owned, refresh, go }: { id: string; owned: Set<string>; refresh: () => Promise<void>; go: (to: string) => void }) {
  const [data, setData] = useState<{ game: Game; builds: { platform: string; version: string; size: number }[]; latest_note?: NoteSummary | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [steamKey, setSteamKey] = useState<SteamKey | null>(null);
  useEffect(() => {
    if (owned.has(id)) api.storeSteamKey(id).then((r) => setSteamKey(r.steam_key), () => setSteamKey(null));
  }, [id, owned]);
  useEffect(() => {
    api.storeGame(id).then(
      (d) => (setData(d), track("game_view", { game: id })),
      () => setNote("This game is not on the store."),
    );
  }, [id]);
  if (!data) return <p className="muted">{note ?? "Loading…"}</p>;
  const g = data.game;
  const own = owned.has(g.id);
  const buy = async () => {
    setBusy(true);
    setNote(null);
    track("checkout_start", { game: g.id, cents: g.price_now_cents ?? g.price_cents });
    try {
      const r = await api.storeCheckout(g.id, { success_url: `${location.origin}/library?bought=${g.id}`, cancel_url: location.href });
      if (r.url) location.href = r.url;
      else {
        await refresh();
        track("got_free", { game: g.id });
        setNote("It's yours. Find it in your library.");
      }
    } catch (e) {
      failed("checkout", g.id, e);
      setNote(e instanceof PartiiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async (platform: string) => {
    track("download", { game: g.id, platform });
    try {
      const blob: Blob = await api.storeDownload(g.id, platform);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${g.id}-${platform}`;
      a.click();
    } catch (e) {
      failed("download", g.id, e);
      setNote(e instanceof PartiiError ? e.message : String(e));
    }
  };
  return (
    <article className="game">
      <Cover g={g} />
      <div className="body">
        <h1>{g.title}</h1>
        <p className="tagline">{g.tagline}</p>
        <p>{g.description}</p>
        <p className="muted">On {g.platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(", ") || "—"}</p>
        {g.demo?.free_levels ? <p className="demo">The first {g.demo.free_levels} levels are free to play.</p> : null}
        {g.demo?.free?.length ? <p className="demo" data-testid="demo-free">Free to play: {g.demo.free.join(", ")}.</p> : null}
        {g.demo?.join_free ? <p className="demo" data-testid="demo-join">Join a friend who owns it, free. Hosting needs the full game.</p> : null}
        {g.play_url && (
          <p>
            <a className="button" href={g.play_url} data-testid="play" onClick={() => track("play", { game: g.id })}>
              Play in your browser
            </a>
          </p>
        )}
        <div className="buy">
          {g.play_url && g.price_cents === 0 ? null : own ? (
            <span className="owned" data-testid="owned">In your library</span>
          ) : (
            <button onClick={buy} disabled={busy} data-testid="buy">
              {busy ? "…" : g.price_now_cents === 0 ? "Get" : "Buy"} · <Price g={g} />
            </button>
          )}
        </div>
        {own && steamKey && <SteamKeyBox k={steamKey} game={g.id} />}
        {(own || g.demo || g.price_cents === 0) && data.builds.length > 0 && (
          <div className="downloads">
            {data.builds.map((b) => (
              <button key={b.platform} className="secondary" onClick={() => download(b.platform)}>
                Download for {PLATFORM_NAMES[b.platform] ?? b.platform}
              </button>
            ))}
          </div>
        )}
        {data.latest_note && (
          <p className="latest-note" data-testid="latest-note">
            Latest update:{" "}
            <Go to={`/games/${g.id}/updates/${encodeURIComponent(data.latest_note.version)}`} go={go}>
              {data.latest_note.title}
            </Go>{" "}
            <span className="muted">· {day(data.latest_note.published_at)} ·</span>{" "}
            <Go to={`/games/${g.id}/updates`} go={go}>
              All updates
            </Go>
          </p>
        )}
        {g.store?.appstore_url && <a href={g.store.appstore_url}>App Store</a>} {g.store?.play_url && <a href={g.store.play_url}>Google Play</a>}
        {note && <p className="note" data-testid="note">{note}</p>}
      </div>
    </article>
  );
}

function Library({ go }: { go: (to: string) => void }) {
  const [games, setGames] = useState<(Game & { steam_key?: SteamKey | null })[] | null>(null);
  useEffect(() => {
    const bought = new URLSearchParams(location.search).get("bought");
    if (bought) track("checkout_return", { game: bought.slice(0, 40) });
    api.storeLibrary().then((r) => setGames(r.games), () => setGames([]));
  }, []);
  if (!games) return <p className="muted">Loading…</p>;
  if (!games.length) return <p className="muted">Nothing here yet. Games you buy show up here on every device you sign in on.</p>;
  return (
    <div className="grid" data-testid="library">
      {games.map((g) => (
        <div key={g.id} className="library-item">
          <a className="card" href={`/games/${g.id}`} onClick={(e) => (e.preventDefault(), go(`/games/${g.id}`))}>
            <Cover g={g} />
            <h3>{g.title}</h3>
          </a>
          {g.steam_key && <SteamKeyBox k={g.steam_key} game={g.id} />}
        </div>
      ))}
    </div>
  );
}

function SignIn({ onDone, signup }: { onDone: (token: string, p: Player) => void; signup?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const failedSignIn = (step: string, e: unknown) => {
    track("signin_failed", { step, code: e instanceof PartiiError ? e.code : "network" });
    if (!(e instanceof PartiiError)) reportError(`sign-in ${step} failed: ${e instanceof Error ? e.message : String(e)}`);
  };
  const start = async () => {
    try {
      const r = await api.playersEmailStart({ email });
      track("signin_code_sent", { signup: !!signup });
      setSent(true);
      setNote(r.sent ? "Check your email for a 6-digit code." : `No mail on this server; your code is ${r.code}.`);
    } catch (e) {
      failedSignIn("code", e);
      setNote(e instanceof PartiiError ? e.message : String(e));
    }
  };
  const finish = async () => {
    try {
      const r = await api.playersLogin({ provider: "email", email, code });
      track(signup ? "signup" : "signin", { merged: !!r.merged });
      onDone(r.player_token, r.player);
      setNote(r.merged ? "Signed in. This browser's games joined your account." : "Signed in.");
    } catch (e) {
      failedSignIn("login", e);
      setNote(e instanceof PartiiError ? e.message : String(e));
    }
  };
  return (
    <form className="signin" onSubmit={(e) => (e.preventDefault(), sent ? finish() : start())}>
      <h1>{signup ? "Create your free account" : "Sign in"}</h1>
      <p className="muted">
        {signup
          ? "Just your email: we send a 6-digit code, with no password to remember. Your games, saves and purchases follow you to every device."
          : "One account for every device: what you buy here plays on your phone and computer."}
      </p>
      <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} data-testid="email" />
      {sent && <input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} data-testid="code" />}
      <button data-testid="signin">{sent ? (signup ? "Create account" : "Sign in") : "Send code"}</button>
      {note && <p className="note" data-testid="signin-note">{note}</p>}
    </form>
  );
}

// ── The player content policy (docs/CONTENT-POLICY.md, rendered here) ──
/** Where takedown requests and appeals go. */
const CONTACT = import.meta.env.VITE_CONTENT_CONTACT ?? "support@sterlinglong.me";

function ContentPolicy() {
  return <Markdown text={policyText.replaceAll("{{CONTACT}}", CONTACT)} />;
}

function Privacy() {
  return <Markdown text={privacyText.replaceAll("{{CONTACT}}", CONTACT)} />;
}

function App() {
  const [path, go] = usePath();
  const { player, owned, refresh, signedIn } = usePlayer();
  const games = useGames();
  const link = (to: string, label: string) => (
    <a href={to} className={path === to ? "on" : ""} onClick={(e) => (e.preventDefault(), go(to))}>
      {label}
    </a>
  );
  useEffect(() => track("page_view", { path: path.slice(0, 100) }), [path]);
  const member = !!player && player.providers.includes("email");
  let page;
  const m = /^\/games\/([a-z0-9-]+)/.exec(path);
  const u = /^\/games\/([a-z0-9-]+)\/updates(?:\/([^/]+))?\/?$/.exec(path);
  if (u?.[2]) page = <Update id={u[1]} version={decodeURIComponent(u[2])} go={go} />;
  else if (u) page = <Updates id={u[1]} go={go} />;
  else if (m) page = <GamePage id={m[1]} owned={owned} refresh={refresh} go={go} />;
  else if (path.startsWith("/games")) page = <AllGames go={go} games={games} />;
  else if (path.startsWith("/library")) page = <Library go={go} />;
  else if (path.startsWith("/signup")) page = <SignIn onDone={signedIn} signup />;
  else if (path.startsWith("/signin")) page = <SignIn onDone={signedIn} />;
  else if (path.startsWith("/content-policy")) page = <ContentPolicy />;
  else if (path.startsWith("/privacy")) page = <Privacy />;
  else if (path.startsWith("/developers")) page = <Developers go={go} />;
  else if (path.startsWith("/admin")) page = <AdminPage api={API} />;
  else if (path.startsWith("/dev")) page = <DevDashboard api={API} />;
  else page = <Home go={go} games={games} signedIn={member} />;
  return (
    <>
      <nav>
        <a href="/" className="brand" onClick={(e) => (e.preventDefault(), go("/"))}>
          partii
        </a>
        {link("/games", "Games")}
        {link("/library", "Library")}
        {link("/developers", "Developers")}
        <span className="spacer" />
        {member ? (
          <span className="muted" data-testid="who">
            {player?.display_name}
          </span>
        ) : (
          <>
            {link("/signin", "Sign in")}
            <a href="/signup" className="button small" onClick={(e) => (e.preventDefault(), go("/signup"))}>
              Sign up
            </a>
          </>
        )}
      </nav>
      <main>{page}</main>
      <footer>
        <a href={LINKS.discord}>Discord</a>
        <a href={LINKS.youtube}>YouTube</a>
        <a href="/developers" onClick={(e) => (e.preventDefault(), go("/developers"))}>
          Developers
        </a>
        <a href="/content-policy" onClick={(e) => (e.preventDefault(), go("/content-policy"))}>
          Content policy
        </a>
        <a href="/privacy" onClick={(e) => (e.preventDefault(), go("/privacy"))}>
          Privacy
        </a>
        <a href={`mailto:${CONTACT}`}>Contact</a>
        <span className="spacer" />
        <a href={LINKS.hub}>Made by Sterling Long</a>
      </footer>
    </>
  );
}

startTracking();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
