// The phone controller: open from a game's QR code (/c/CODE?k=KEY&e=EDGE),
// or type a room code. Joins the room as a `phone` member and plays as one
// more gamepad (docs/CONTROLLER.md).
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BUTTON, inputFrame, startEngine, type Engine } from "./engine";
import { Stick, type Vec } from "./stick";
import "./style.css";

const DEFAULT_EDGE = "https://partii-edge-staging.partii-games.workers.dev";

function params() {
  const m = /^\/c\/([A-Za-z]{4,8})/.exec(location.pathname);
  const q = new URLSearchParams(location.search);
  return { code: m ? m[1].toUpperCase() : null, key: q.get("k") ?? "", edge: q.get("e") ?? DEFAULT_EDGE };
}

function storedName(): string {
  try {
    return localStorage.getItem("partii.name") ?? "";
  } catch {
    return "";
  }
}

type Phase = { kind: "connecting" } | { kind: "joined"; host: number } | { kind: "error"; message: string } | { kind: "closed" };

function Controller({ code, keyStr, edge, name }: { code: string; keyStr: string; edge: string; name: string }) {
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
              e.join(code, "phone", name, { name });
            } else if (ev.ev === "joined") {
              host = ev.room.host;
              setPhase({ kind: "joined", host: ev.room.host });
              e.send(ev.room.host, true, new TextEncoder().encode(JSON.stringify({ t: "hello", name, player: null })));
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
  }, [code, keyStr, edge, name]);

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
    <div className="pad" style={{ ["--tint" as string]: tint }}>
      <header>
        <span className="status" data-testid="status">{phase.kind === "joined" ? `${seat?.label ?? "Connected"} · ${code}` : `Joining ${code}…`}</span>
        <button className="start" data-testid="start" {...hold(BUTTON.START)}>START</button>
      </header>
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

function App() {
  const p = params();
  if (!p.code) return <Join />;
  return <Controller code={p.code} keyStr={p.key} edge={p.edge} name={storedName() || "Phone"} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
