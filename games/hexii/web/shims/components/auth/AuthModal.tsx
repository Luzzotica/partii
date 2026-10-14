import { useState } from "react";
import { partiiErrorMessage } from "../../../src/partii";
import { ensureGuest } from "../../../src/player";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Shown when a run ends before the guest sign-in has succeeded. */
export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const retry = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await ensureGuest();
      onClose();
    } catch (err) {
      setMessage(partiiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div className="font-orbitron relative z-10 w-full max-w-sm rounded-2xl border border-white/15 bg-[#12121f] p-6 text-center shadow-2xl">
        <h2 className="mb-2 text-xl font-bold tracking-wide text-white">
          Score not saved
        </h2>
        <p className="mb-6 text-sm text-white/70">
          This browser could not sign in as a guest, so the run stayed on this
          device.
        </p>
        {message && <p className="mb-4 text-sm text-[#ff6b81]">{message}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="w-full rounded-lg bg-[#3742fa] py-3 font-semibold tracking-wide text-white hover:bg-[#5a67fa] disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Try again"}
        </button>
      </div>
    </div>
  );
}
