interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Accounts arrive with partii guest sign-in. This only closes the prompt. */
export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-blue-200/30 bg-slate-900 p-6 text-center shadow-2xl">
        <h2 className="mb-2 text-xl font-bold text-white">Scores are coming</h2>
        <p className="mb-6 text-sm text-white/70">
          This climb is not saved yet. A partii account will keep your altitude
          once the leaderboard is connected.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-blue-500 py-3 font-semibold text-white hover:bg-blue-400"
        >
          Keep climbing
        </button>
      </div>
    </div>
  );
}
