import { useState } from "react";
import { partiiErrorMessage } from "./partii";
import {
  ensureGuest,
  finishEmailSignIn,
  getPlayerError,
  renamePlayer,
  startEmailSignIn,
  usePartiiPlayer,
  usePlayerStatus,
} from "./player";

export function AccountBar() {
  const player = usePartiiPlayer();
  const status = usePlayerStatus();
  const [name, setName] = useState(player?.display_name ?? "");
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const shownName = editing ? name : (player?.display_name ?? name);

  const saveName = async () => {
    setBusy(true);
    setHint(null);
    try {
      await renamePlayer(shownName);
      setEditing(false);
    } catch (err) {
      setHint(partiiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setHint(null);
    try {
      const result = await startEmailSignIn(email);
      if (result.code) {
        setCode(result.code);
        setHint("Staging has no mail sender. The code is filled in below.");
      } else {
        setHint("Check your email for a code.");
      }
    } catch (err) {
      setHint(partiiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setBusy(true);
    setHint(null);
    try {
      await finishEmailSignIn(email, code);
      setShowEmail(false);
      setHint("Signed in. Scores from this browser stay on that account.");
    } catch (err) {
      setHint(partiiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (status === "error") {
    return (
      <div className="font-orbitron mt-6 text-sm text-white/60">
        <p>{getPlayerError() ?? "Could not sign in."}</p>
        <button
          type="button"
          className="mt-2 text-[#a8a8ff] underline"
          onClick={() => {
            ensureGuest().catch(() => {});
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!player) return null;

  return (
    <div className="font-orbitron mt-6 text-sm text-white/70">
      <div className="flex items-center justify-center gap-2">
        <label htmlFor="pilot-name" className="text-white/50">
          Name
        </label>
        <input
          id="pilot-name"
          value={shownName}
          maxLength={40}
          onChange={(event) => {
            setEditing(true);
            setName(event.target.value);
          }}
          onBlur={() => {
            if (editing && shownName.trim() && shownName.trim() !== player.display_name) {
              void saveName();
            }
          }}
          className="w-40 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white"
        />
      </div>
      {player.guest && !showEmail && (
        <button
          type="button"
          className="mt-3 text-[#a8a8ff]/80 hover:text-white"
          onClick={() => setShowEmail(true)}
        >
          Sign in with email to keep this name
        </button>
      )}
      {!player.guest && <p className="mt-2 text-white/40">Signed in</p>}
      {showEmail && player.guest && (
        <div className="mx-auto mt-3 flex max-w-xs flex-col gap-2">
          <input
            type="email"
            value={email}
            placeholder="Email"
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={busy || !email.includes("@")}
            onClick={() => void sendCode()}
            className="rounded-lg bg-white/10 py-2 text-white disabled:opacity-40"
          >
            Send code
          </button>
          <input
            inputMode="numeric"
            value={code}
            placeholder="Code"
            onChange={(event) => setCode(event.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={busy || code.trim().length < 4}
            onClick={() => void confirmCode()}
            className="rounded-lg bg-[#3742fa] py-2 font-semibold text-white disabled:opacity-40"
          >
            Sign in
          </button>
        </div>
      )}
      {hint && <p className="mt-2 text-xs text-[#a8a8ff]/80">{hint}</p>}
      <p className="mt-3 text-[10px] text-white/30">
        <a
          href="https://partii.games/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-white/60"
        >
          What this game records
        </a>
      </p>
    </div>
  );
}
