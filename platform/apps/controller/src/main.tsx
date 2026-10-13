// The phone controller: open from a game's QR code (/c/CODE?k=KEY&e=EDGE&g=GAME),
// or type a room code. Joins the room as a `phone` member and plays as one
// more gamepad (docs/CONTROLLER.md).
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BUTTON, inputFrame, startEngine, type Engine } from "./engine";
import { Stick, type Vec } from "./stick";
import { fetchProfile, finishEmail, signOut, startEmail, storedPlayer } from "./account";
import { bootTheme, currentTheme, THEME_EVENT, themeFor } from "./theme";
import "./style.css";

const DEFAULT_EDGE = "https://partii-edge.partii-games.workers.dev";

function params() {
  const m = /^\/c\/([A-Za-z]{4,8})/.exec(location.pathname);
  const q = new URLSearchParams(location.search);
  // The sign-in page carries the controller's link in ?back=.
  const back = new URLSearchParams((q.get("back") ?? "").split("?")[1] ?? "");
  return { code: m ? m[1].toUpperCase() : null, key: q.get("k") ?? "", edge: q.get("e") ?? back.get("e") ?? DEFAULT_EDGE, game: q.get("g") ?? back.get("g") };
}

/** The applied theme, re-read whenever another one is applied. */
function useTheme() {
  const [t, setT] = useState(currentTheme);
  useEffect(() => {
    const on = () => setT(currentTheme());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return t;
}

function storedName(): string {
  try {
    return localStorage.getItem("partii.name") ?? "";
  } catch {
    return "";
  }
}

/** Shown while the platform refuses this network for a minute (many players behind one IP); the engine keeps retrying. */
const BUSY = "Lots of players are on this network right now. Still trying, this can take up to a minute…";
/** A refused join is retried after this long. */
const JOIN_RETRY_MS = 10_000;

type Phase = { kind: "connecting"; note?: string } | { kind: "joined"; host: number } | { kind: "error"; message: string } | { kind: "closed" };

function Controller({ code, keyStr, edge, name, game }: { code: string; keyStr: string; edge: string; name: string; game: string | null }) {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [seat, setSeat] = useState<{ label: string; color: string } | null>(null);
  const [labels, setLabels] = useState<string[]>(["FIRE", "SECONDARY"]);
  const move = useRef<Vec>({ x: 0, y: 0 });
  const aim = useRef<Vec>({ x: 0, y: 0 });
  const buttons = useRef(0);
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    let host: number | null = null;
    let seq = 0;
    let joined = false;
    let timer = 0;
    let lastSent = "";
    startEngine(edge, keyStr, null).then(
      (e) => {
        engine.current = e;
        timer = window.setInterval(() => {
          for (const ev of e.poll()) {
            if (ev.ev === "online" && !joined) {
              joined = true;
              setPhase({ kind: "connecting" });
              e.join(code, "phone", name, { name });
            } else if (ev.ev === "error" && !joined) {
              // A refused hello (rate_limited) has no request id, so it comes as a
              // plain error; the engine reconnects by itself.
              setPhase({ kind: "connecting", note: /too many/i.test(ev.message ?? "") ? BUSY : ev.message });
            } else if (ev.ev === "failed" && ev.code === "rate_limited") {
              setPhase({ kind: "connecting", note: BUSY });
              window.setTimeout(() => e.join(code, "phone", name, { name }), JOIN_RETRY_MS);
            } else if (ev.ev === "joined") {
              host = ev.room.host;
              const to = ev.room.host;
              setPhase({ kind: "joined", host: to });
              // A typed code: the link didn't name the game, so theme the page now.
              if (!game) themeFor(edge, ev.room.game);
              // Signed in: bring the player's own name and look for this game.
              const player = storedPlayer();
              const hello = (profile: Record<string, unknown> | null) =>
                e.send(to, true, new TextEncoder().encode(JSON.stringify({ t: "hello", name, player: player?.id ?? null, profile })));
              if (player) fetchProfile(edge, keyStr, ev.room.game, player).then(hello);
              else hello(null);
            } else if (ev.ev === "failed") {
              setPhase({ kind: "error", message: ev.code === "not_found" ? `No room ${code}. Check the code on the game's screen.` : ev.message });
            } else if (ev.ev === "room_closed") {
              setPhase({ kind: "closed" });
              host = null;
            } else if (ev.ev === "message" && ev.from === host && ev.reliable) {
              try {
                const m = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.bytes)));
                if (m.t === "seat") setSeat({ label: m.label, color: m.color });
                if (m.t === "layout" && Array.isArray(m.buttons)) setLabels(m.buttons);
                if (m.t === "rumble" && navigator.vibrate) navigator.vibrate(Math.min(m.ms ?? 80, 400));
              } catch {
                /* not JSON */
              }
            }
          }
          if (host !== null) {
            // ~30 Hz, plus at once when something changes.
            const now = `${move.current.x.toFixed(2)},${move.current.y.toFixed(2)},${aim.current.x.toFixed(2)},${aim.current.y.toFixed(2)},${buttons.current}`;
            if (now !== lastSent || seq % 2 === 0) {
              e.send(host, false, inputFrame(++seq, move.current.x, move.current.y, aim.current.x, aim.current.y, buttons.current));
              lastSent = now;
            } else {
              seq++;
            }
          }
        }, 16);
      },
      (err) => setPhase({ kind: "error", message: `Could not start: ${err}` }),
    );
    return () => {
      window.clearInterval(timer);
      engine.current?.leave();
    };
  }, [code, keyStr, edge, name, game]);

  const hold = (bit: number) => ({
    onPointerDown: (ev: React.PointerEvent) => {
      (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
      buttons.current |= bit;
      navigator.vibrate?.(10);
    },
    onPointerUp: () => (buttons.current &= ~bit),
    onPointerCancel: () => (buttons.current &= ~bit),
  });

  if (phase.kind === "error") return <Message title="Can't join" body={phase.message} />;
  if (phase.kind === "closed") return <Message title="Game over" body="The host closed the room." />;

  const tint = seat?.color ?? "#3b82f6";
  return (
    <div className={seat ? "pad seated" : "pad"} style={{ ["--tint" as string]: tint }}>
      <header>
        {theme?.logo && <img className="logo" src={theme.logo} alt={theme.name ?? ""} />}
        <span className="status" data-testid="status">{phase.kind === "joined" ? `${seat?.label ?? "Connected"} · ${code}` : `Joining ${code}…`}</span>
        {!storedPlayer() && (
          <a className="signin-link" data-testid="signin-link" href={`/signin?back=${encodeURIComponent(location.pathname + location.search)}`}>
            Sign in
          </a>
        )}
        <button className="start" data-testid="start" {...hold(BUTTON.START)}>START</button>
      </header>
      {phase.kind === "connecting" && phase.note && <p className="note" data-testid="note">{phase.note}</p>}
      <Stick label="MOVE" onChange={(v) => (move.current = v)} testId="move" />
      <div className="right">
        <Stick label="AIM" onChange={(v) => (aim.current = v)} testId="aim" />
        <div className="buttons">
          <button className="fire" data-testid="fire" {...hold(BUTTON.PRIMARY | BUTTON.CONFIRM)}>{labels[0] ?? "FIRE"}</button>
          <button className="second" data-testid="secondary" {...hold(BUTTON.SECONDARY)}>{labels[1] ?? "SECONDARY"}</button>
        </div>
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="message">
      <h1>{title}</h1>
      <p>{body}</p>
      <a href="/">Enter a room code</a>
    </div>
  );
}

function Join() {
  const [code, setCode] = useState("");
  const [name, setName] = useState(storedName());
  const go = () => {
    try {
      localStorage.setItem("partii.name", name);
    } catch {
      /* private mode */
    }
    location.href = `/c/${code.toUpperCase()}${location.search}`;
  };
  return (
    <form className="join" onSubmit={(e) => (e.preventDefault(), go())}>
      <h1>Join a game</h1>
      <input aria-label="Room code" placeholder="ROOM CODE" value={code} maxLength={8} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, ""))} />
      <input aria-label="Your name" placeholder="Your name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      <button disabled={code.length < 4}>Join</button>
    </form>
  );
}

/** Email sign-in; returns to `?back=` (the controller) when done. */
function SignIn() {
  const p = params();
  const back = new URLSearchParams(location.search).get("back") ?? "/";
  const backQ = new URLSearchParams(back.split("?")[1] ?? "");
  const edge = backQ.get("e") ?? p.edge;
  const key = backQ.get("k") ?? p.key;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const send = async () => {
    setErr("");
    const r = await startEmail(edge, key, email);
    if (!r.ok) return setErr(r.error ?? "");
    setSent(true);
    if (r.code) setCode(r.code); // dev/staging: no mail provider, the code comes back
  };
  const finish = async () => {
    setErr("");
    const r = await finishEmail(edge, key, email, code);
    if (!r.ok) return setErr(r.error ?? "");
    location.href = back;
  };
  const me = storedPlayer();
  if (me)
    return (
      <div className="message">
        <h1>Signed in</h1>
        <p data-testid="signed-in">{me.name || me.id}</p>
        <button onClick={() => (signOut(), location.reload())}>Sign out</button>
        <a href={back}>Back</a>
      </div>
    );
  return (
    <form className="join" onSubmit={(e) => (e.preventDefault(), sent ? finish() : send())}>
      <h1>Sign in</h1>
      <p>Your name and look come with you into the game.</p>
      <input aria-label="Email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      {sent && <input aria-label="Code" placeholder="6-digit code" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />}
      <button disabled={!email.includes("@") || (sent && code.length < 6)}>{sent ? "Sign in" : "Send code"}</button>
      {err && <p className="error">{err}</p>}
      <a href={back}>Skip</a>
    </form>
  );
}

function App() {
  const p = params();
  if (location.pathname.startsWith("/signin")) return <SignIn />;
  if (!p.code) return <Join />;
  return <Controller code={p.code} keyStr={p.key} edge={p.edge} game={p.game} name={storedPlayer()?.name || storedName() || "Phone"} />;
}

// The game's theme goes on before the first render (no flash of partii's look).
const boot = params();
bootTheme(boot.edge, boot.game).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
