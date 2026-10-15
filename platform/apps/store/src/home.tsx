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
          <h2>Imagine a party game. Your AI builds it on partii.</h2>
          <p>partii gives your AI coding agent every tool a party game needs: online rooms, phone controllers, accounts, saves, leaderboards, analytics and hosting. Describe the game; your AI builds it and puts it live at yourgame.partii.games.</p>
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
  ["Phones as controllers", "Players scan a QR code and their phone becomes a gamepad. Your AI builds the controller page and hosts it with the game."],
  ["Accounts and cloud saves", "Every player gets a guest account on first launch. Later they can sign in with email, Steam, Discord or Game Center, and their saves follow them to every device."],
  ["Sell everywhere at once", "One purchase unlocks the game on the web store, Steam, the App Store and Google Play. Demos and sales are built in."],
  ["Leaderboards", "Daily, weekly and all-time boards with ranks."],
  ["Analytics and crash reports", "Players, sessions, retention, funnels, and crashes grouped by bug, readable from the dashboard or the command line."],
  ["Hosting", "One command puts the game live at yourgame.partii.games, with previews and rollback. It handles Unity, Godot and threaded wasm builds."],
  ["Player-made levels", "Players share levels and replays. partii handles uploads, browsing, votes and moderation."],
];

/** Why an AI agent gets along with partii: all true of the CLI and API today. */
const AGENT_FEATURES: [string, string][] = [
  ["One tool, plain JSON", "Every partii command prints one JSON document, so your AI reads results instead of scraping text."],
  ["Errors that say what to do", "Every failure comes with a hint for the next step, so your AI fixes the problem instead of guessing."],
  ["Try before it changes anything", "Add --dry-run to any change to see what it would do. Staging is a full copy of partii to test on."],
  ["Test players on tap", "Bots join a room like real players, so your AI can test multiplayer without a second person."],
  ["The whole API, described", "An OpenAPI spec, a typed client for Rust and TypeScript, and a guide written to be read by an agent."],
  ["It sees what players see", "Crash reports grouped by bug, plus analytics, all readable from the command line, so your AI can find a bug and ship the fix."],
];

const PROMPT = `Build a party game on partii. Start by reading https://partii.games/llms.txt and follow the guide it links. My game: `;

function PromptBox() {
  const copy = () => navigator.clipboard?.writeText(PROMPT).catch(() => {});
  return (
    <div className="prompt-box">
      <div className="prompt-head">
        <span>Paste this into your AI coding agent and describe your game</span>
        <button type="button" className="secondary" onClick={copy}>
          Copy
        </button>
      </div>
      <code>
        {PROMPT}
        <span className="prompt-fill">a 4-player game where everyone's phone is a paddle and…</span>
      </code>
    </div>
  );
}

export function Developers({ go }: { go: Go }) {
  return (
    <div className="home devs">
      <section className="hero solo">
        <div>
          <h1>Imagine the party game. Your AI builds it.</h1>
          <p className="lede">
            partii gives your AI coding agent every tool a party game needs: online rooms, phone controllers, accounts, saves, sales, leaderboards, analytics and hosting. You describe the game. Your AI builds it, tests it, and puts it live on partii.
          </p>
          <PromptBox />
          <div className="cta">
            <a className="button" href="/llms.txt">
              What your AI reads
            </a>
            <a className="button secondary" href={LINKS.discord}>
              Join the Discord
            </a>
          </div>
        </div>
      </section>

      <section className="steps">
        <h2>How it works</h2>
        <ol>
          <li>
            <b>Imagine it.</b> Tell your AI the game you want: the rules, the vibe, how many players, what the phones do.
          </li>
          <li>
            <b>Your AI builds it.</b> It reads partii's guide and uses partii's tools for multiplayer, controllers, accounts, saves and scores. There's no server for you to run.
          </li>
          <li>
            <b>It goes live.</b> One command puts it at yourgame.partii.games. Play it with friends, and your AI reads the crash reports and fixes what breaks.
          </li>
        </ol>
      </section>

      <section className="features">
        <h2>Built for AI agents</h2>
        <div className="feature-grid">
          {AGENT_FEATURES.map(([t, d]) => (
            <div key={t}>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="features">
        <h2>Everything your game runs on</h2>
        <div className="feature-grid">
          {DEV_FEATURES.map(([t, d]) => (
            <div key={t}>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
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
          <div>
            <b>Reviewed for all ages</b>
            <p>partii is for everyone, so every game is reviewed against our content policy before it goes public.</p>
          </div>
        </div>
      </section>

      <section className="dev-band">
        <div>
          <h2>Developer sign-up opens soon</h2>
          <p>Want in early? Say hi on Discord and tell us what you're imagining.</p>
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
