// The partii store: browse games, buy them, download them, see your library.
// Plain React talking to the generated API client, so the same app can ship
// as a downloadable Tauri app later.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, PartiiError } from "../../../sdk/ts/src/client";
import "./style.css";

const API = import.meta.env.VITE_PARTII_API ?? "https://partii-edge-staging.partii-games.workers.dev";
const KEY = import.meta.env.VITE_PARTII_KEY ?? "";
const api = createClient({ base: API, key: KEY });

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

function deviceId(): string {
  let id = store<string>("partii.device");
  if (!id) id = store("partii.device", crypto.randomUUID().replace(/-/g, ""))!;
  return id;
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
  demo: { free_levels?: number } | null;
  platforms: string[];
  store: { cover?: string; screenshots?: string[]; trailer?: string; appstore_url?: string; play_url?: string };
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

function Front({ go }: { go: (to: string) => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    api.storeGames().then((r) => setGames(r.games), () => setGames([]));
  }, []);
  if (!games) return <p className="muted">Loading…</p>;
  if (!games.length) return <p className="muted">No games yet.</p>;
  return (
    <div className="grid">
      {games.map((g) => (
        <a key={g.id} className="card" href={`/games/${g.id}`} onClick={(e) => (e.preventDefault(), go(`/games/${g.id}`))} data-testid={`game-${g.id}`}>
          <Cover g={g} />
          <h3>{g.title}</h3>
          <p className="muted">{g.tagline}</p>
          <Price g={g} />
        </a>
      ))}
    </div>
  );
}

const PLATFORM_NAMES: Record<string, string> = { macos: "Mac", windows: "Windows", linux: "Linux", ios: "iPhone & iPad", android: "Android", web: "Browser" };

function GamePage({ id, owned, refresh }: { id: string; owned: Set<string>; refresh: () => Promise<void> }) {
  const [data, setData] = useState<{ game: Game; builds: { platform: string; version: string; size: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.storeGame(id).then(setData, () => setNote("This game is not on the store."));
  }, [id]);
  if (!data) return <p className="muted">{note ?? "Loading…"}</p>;
  const g = data.game;
  const own = owned.has(g.id);
  const buy = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.storeCheckout(g.id, { success_url: `${location.origin}/library?bought=${g.id}`, cancel_url: location.href });
      if (r.url) location.href = r.url;
      else {
        await refresh();
        setNote("It's yours. Find it in your library.");
      }
    } catch (e) {
      setNote(e instanceof PartiiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async (platform: string) => {
    try {
      const blob: Blob = await api.storeDownload(g.id, platform);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${g.id}-${platform}`;
      a.click();
    } catch (e) {
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
        <div className="buy">
          {own ? (
            <span className="owned" data-testid="owned">In your library</span>
          ) : (
            <button onClick={buy} disabled={busy} data-testid="buy">
              {busy ? "…" : g.price_now_cents === 0 ? "Get" : "Buy"} · <Price g={g} />
            </button>
          )}
        </div>
        {(own || g.demo || g.price_cents === 0) && data.builds.length > 0 && (
          <div className="downloads">
            {data.builds.map((b) => (
              <button key={b.platform} className="secondary" onClick={() => download(b.platform)}>
                Download for {PLATFORM_NAMES[b.platform] ?? b.platform}
              </button>
            ))}
          </div>
        )}
        {g.store?.appstore_url && <a href={g.store.appstore_url}>App Store</a>} {g.store?.play_url && <a href={g.store.play_url}>Google Play</a>}
        {note && <p className="note" data-testid="note">{note}</p>}
      </div>
    </article>
  );
}

function Library({ go }: { go: (to: string) => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    api.storeLibrary().then((r) => setGames(r.games), () => setGames([]));
  }, []);
  if (!games) return <p className="muted">Loading…</p>;
  if (!games.length) return <p className="muted">Nothing here yet. Games you buy show up here on every device you sign in on.</p>;
  return (
    <div className="grid" data-testid="library">
      {games.map((g) => (
        <a key={g.id} className="card" href={`/games/${g.id}`} onClick={(e) => (e.preventDefault(), go(`/games/${g.id}`))}>
          <Cover g={g} />
          <h3>{g.title}</h3>
        </a>
      ))}
    </div>
  );
}

function SignIn({ onDone }: { onDone: (token: string, p: Player) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const start = async () => {
    try {
      const r = await api.playersEmailStart({ email });
      setSent(true);
      setNote(r.sent ? "Check your email for a 6-digit code." : `No mail on this server; your code is ${r.code}.`);
    } catch (e) {
      setNote(e instanceof PartiiError ? e.message : String(e));
    }
  };
  const finish = async () => {
    try {
      const r = await api.playersLogin({ provider: "email", email, code });
      onDone(r.player_token, r.player);
      setNote(r.merged ? "Signed in. This browser's games joined your account." : "Signed in.");
    } catch (e) {
      setNote(e instanceof PartiiError ? e.message : String(e));
    }
  };
  return (
    <form className="signin" onSubmit={(e) => (e.preventDefault(), sent ? finish() : start())}>
      <h1>Sign in</h1>
      <p className="muted">One account for every device: what you buy here plays on your phone and computer.</p>
      <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} data-testid="email" />
      {sent && <input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} data-testid="code" />}
      <button data-testid="signin">{sent ? "Sign in" : "Send code"}</button>
      {note && <p className="note" data-testid="signin-note">{note}</p>}
    </form>
  );
}

function App() {
  const [path, go] = usePath();
  const { player, owned, refresh, signedIn } = usePlayer();
  const link = (to: string, label: string) => (
    <a href={to} className={path === to ? "on" : ""} onClick={(e) => (e.preventDefault(), go(to))}>
      {label}
    </a>
  );
  let page;
  const m = /^\/games\/([a-z0-9-]+)/.exec(path);
  if (m) page = <GamePage id={m[1]} owned={owned} refresh={refresh} />;
  else if (path.startsWith("/library")) page = <Library go={go} />;
  else if (path.startsWith("/signin")) page = <SignIn onDone={signedIn} />;
  else page = <Front go={go} />;
  return (
    <>
      <nav>
        <a href="/" className="brand" onClick={(e) => (e.preventDefault(), go("/"))}>
          partii
        </a>
        {link("/", "Store")}
        {link("/library", "Library")}
        <span className="spacer" />
        {player && !player.providers.includes("email") ? link("/signin", "Sign in") : <span className="muted" data-testid="who">{player?.display_name}</span>}
      </nav>
      <main>{page}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
