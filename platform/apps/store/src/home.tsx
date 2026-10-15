// partii.games' front page (players first) and /developers (the pitch to
// game makers). Facts here must match what the platform does: docs/GUIDE.md.
import type { MouseEvent, ReactNode } from "react";

export interface HomeGame {
  id: string;
  title: string;
  tagline: string;
  price_cents: number;
  price_now_cents: number;
  currency: string;
  platforms: string[];
  store: { cover?: string };
  play_url?: string | null;
}

export const LINKS = {
  discord: "https://discord.gg/kPufR79dSV",
  youtube: "https://www.youtube.com/@sterlong",
  hub: "https://sterlinglong.me",
  guide: "https://github.com/Luzzotica/partii/blob/main/platform/docs/GUIDE.md",
};

type Go = (to: string) => void;

function A({ to, go, className, testid, children }: { to: string; go: Go; className?: string; testid?: string; children: ReactNode }) {
  return (
    <a href={to} className={className} data-testid={testid} onClick={(e: MouseEvent) => (e.preventDefault(), go(to))}>
      {children}
    </a>
  );
}

const price = (g: HomeGame) => (g.price_now_cents === 0 ? "Free" : new Intl.NumberFormat(undefined, { style: "currency", currency: g.currency || "USD" }).format(g.price_now_cents / 100));

export function GameCard({ g, go }: { g: HomeGame; go: Go }) {
  return (
    <A to={`/games/${g.id}`} go={go} className="card" testid={`game-${g.id}`}>
      {g.store?.cover ? <img className="cover" src={g.store.cover} alt="" /> : <div className="cover placeholder">{g.title.slice(0, 1)}</div>}
      <h3>{g.title}</h3>
      <p className="muted">{g.tagline}</p>
      <span className="price">{g.play_url && g.price_now_cents === 0 ? "Free · play in your browser" : price(g)}</span>
    </A>
  );
}

/** A room code and a phone: what joining looks like. */
function JoinArt() {
  return (
    <div className="join-art" aria-hidden="true">
      <div className="tv">
        <div className="tv-label">Join at partii.games</div>
        <div className="tv-code">KZ4P</div>
        <div className="tv-seats">
          <span className="seat s1" />
          <span className="seat s2" />
          <span className="seat s3" />
          <span className="seat s4 empty" />
        </div>
      </div>
      <div className="phone">
        <div className="pad">
          <span className="stick" />
          <span className="btn a" />
          <span className="btn b" />
        </div>
      </div>
    </div>
  );
}

export function Home({ go, games, signedIn }: { go: Go; games: HomeGame[] | null; signedIn: boolean }) {
  const store = (games ?? []).filter((g) => !(g.play_url && g.price_cents === 0));
  const arcade = (games ?? []).filter((g) => g.play_url && g.price_cents === 0);
  return (
    <div className="home">
      <section className="hero">
        <div>
          <h1>Party games you play together, anywhere.</h1>
          <p className="lede">
            Friends join with a short code or a QR scan, in the same room or across the country. Phones become controllers, so nobody needs a gamepad.
          </p>
          <div className="cta">
            <A to="/games" go={go} className="button">
              Browse games
            </A>
            {!signedIn && (
              <A to="/signup" go={go} className="button secondary">
                Sign up free
              </A>
            )}
          </div>
        </div>
        <JoinArt />
      </section>

      <section className="steps">
        <h2>How it works</h2>
        <ol>
          <li>
            <b>Pick a game.</b> Play on a computer, a TV, a phone or right in the browser.
          </li>
          <li>
            <b>Share the code.</b> Everyone joins with four letters or a QR scan, from any network: home Wi-Fi, a phone hotspot, school.
          </li>
          <li>
            <b>Grab your phone.</b> In games that support it, your phone is the controller. No apps, no pairing.
          </li>
        </ol>
      </section>

      {store.length > 0 && (
        <section>
          <div className="row-head">
            <h2>Games</h2>
            <A to="/games" go={go}>
              See all
            </A>
          </div>
          <div className="grid">
            {store.slice(0, 6).map((g) => (
              <GameCard key={g.id} g={g} go={go} />
            ))}
          </div>
        </section>
      )}

      {arcade.length > 0 && (
        <section>
          <div className="row-head">
            <h2>Arcade: play now in your browser</h2>
          </div>
          <div className="grid">
            {arcade.map((g) => (
              <GameCard key={g.id} g={g} go={go} />
            ))}
          </div>
        </section>
      )}
      {!games && <p className="muted">Loading games…</p>}

      <section className="features">
        <h2>One free account for every game</h2>
        <div className="feature-grid">
          <div>
            <b>Every device</b>
            <p>Your games, saves and purchases follow you across Mac, Windows, Linux, iPhone, Android and the browser.</p>
          </div>
          <div>
            <b>Start as a guest</b>
            <p>Play right away, with no sign-up. Make it a real account later; your progress comes with you.</p>
          </div>
          <div>
            <b>Leaderboards</b>
            <p>Daily, weekly and all-time boards, so you can see where you stand.</p>
          </div>
          <div>
            <b>Made for all ages</b>
            <p>Everything shared on partii is reviewed against our content policy.</p>
          </div>
        </div>
        {!signedIn && (
          <A to="/signup" go={go} className="button">
            Create your free account
          </A>
        )}
      </section>

      <section className="dev-band">
        <div>
          <h2>Make party games? Put yours on partii.</h2>
          <p>Online play that connects through any network, phone controllers, accounts, saves, sales, leaderboards and analytics. Host your game at yourgame.partii.games. Free for free games.</p>
        </div>
        <A to="/developers" go={go} className="button">
          For developers
        </A>
      </section>
    </div>
  );
}

const DEV_FEATURES: [string, string][] = [
  ["Online play that just connects", "Rooms with short codes. Players connect directly when they can and through a relay when they can't, so it works on any network, behind any router."],
  ["Phones as controllers", "Players scan a QR code and their phone becomes a gamepad. Build your own controller page and host it with your game."],
  ["Accounts and cloud saves", "Every player gets a guest account on first launch. Later they can sign in with email, Steam, Discord or Game Center, and their saves follow them to every device."],
  ["Sell everywhere at once", "Buy once, play everywhere: one purchase unlocks your game on the web store, Steam, the App Store and Google Play. Demos and sales are built in."],
  ["Leaderboards", "Daily, weekly and all-time boards with ranks, in a couple of lines of code."],
  ["Analytics and crash reports", "Players, sessions, retention, funnels, and crashes grouped by bug, on your own dashboard."],
  ["Web hosting", "Deploy a folder and it's live at yourgame.partii.games, with previews and one-command rollback. It handles Unity, Godot and threaded wasm builds."],
  ["Player-made levels", "Let players share levels and replays. partii handles uploads, browsing, votes and moderation."],
];

export function Developers({ go }: { go: Go }) {
  return (
    <div className="home devs">
      <section className="hero solo">
        <div>
          <h1>Make the party game. We handle the hard parts.</h1>
          <p className="lede">partii is the platform under your game: networking, phone controllers, accounts, saves, sales, leaderboards, analytics and hosting. One command-line tool, one API, built for small teams.</p>
          <div className="cta">
            <a className="button" href={LINKS.guide}>
              Read the guide
            </a>
            <a className="button secondary" href={LINKS.discord}>
              Join the Discord
            </a>
          </div>
        </div>
      </section>

      <section className="features">
        <h2>What you get</h2>
        <div className="feature-grid">
          {DEV_FEATURES.map(([t, d]) => (
            <div key={t}>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="steps">
        <h2>How publishing works</h2>
        <ol>
          <li>
            <b>Create a developer account.</b> It's free.
          </li>
          <li>
            <b>Upload your game.</b> A browser build, downloads for Mac, Windows and Linux, or both.
          </li>
          <li>
            <b>Publish.</b> partii is for all ages, so we review every game against our content policy before it goes public.
          </li>
        </ol>
      </section>

      <section className="features pricing">
        <h2>Pricing</h2>
        <div className="feature-grid">
          <div>
            <b>Free games: free to host</b>
            <p>No fees for hosting, multiplayer, accounts, leaderboards or analytics on free games.</p>
          </div>
          <div>
            <b>Paid games: coming soon</b>
            <p>When selling opens, you choose partii's share, with 10% as the default.</p>
          </div>
        </div>
      </section>

      <section className="dev-band">
        <div>
          <h2>Developer sign-up opens soon</h2>
          <p>Want in early? Say hi on Discord and tell us about your game.</p>
        </div>
        <a className="button" href={LINKS.discord}>
          Get early access
        </a>
      </section>
      <p className="muted small center">
        <A to="/dev" go={go}>
          Already a partii developer? Open your dashboard
        </A>
      </p>
    </div>
  );
}
