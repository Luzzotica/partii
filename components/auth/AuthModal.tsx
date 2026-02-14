"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth-context";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: "signin" | "signup";
}

export function AuthModal({
  isOpen,
  onClose,
  initialMode = "signin",
}: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { signInWithEmail, signUpWithEmail } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error } = await signInWithEmail(email, password);
        if (error) {
          setError(error.message);
        } else {
          onClose();
        }
      } else {
        if (!displayName.trim()) {
          setError("Please enter a display name");
          setLoading(false);
          return;
        }
        const { error } = await signUpWithEmail(
          email,
          password,
          displayName.trim(),
        );
        if (error) {
          setError(error.message);
        } else {
          setMessage("Check your email for a confirmation link!");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/10 rounded-2xl p-6 md:p-8 w-full max-w-[400px] relative shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 bg-transparent border-none text-white/50 text-2xl cursor-pointer transition-colors hover:text-white leading-none"
          onClick={onClose}
        >
          ×
        </button>

        <h2 className="text-center text-white text-2xl md:text-3xl font-bold mb-6">
          {mode === "signin" ? "Welcome Back" : "Create Account"}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="displayName"
                className="text-white/70 text-sm font-medium"
              >
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you'll appear on leaderboards"
                required
                maxLength={30}
                disabled={loading}
                className="px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white text-base outline-none transition-all focus:border-[#3742fa] focus:shadow-[0_0_0_3px_rgba(55,66,250,0.2)] disabled:opacity-50 placeholder:text-white/30"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="email"
              className="text-white/70 text-sm font-medium"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="you@example.com"
              required
              disabled={loading}
              className="px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white text-base outline-none transition-all focus:border-[#3742fa] focus:shadow-[0_0_0_3px_rgba(55,66,250,0.2)] disabled:opacity-50 placeholder:text-white/30"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="password"
              className="text-white/70 text-sm font-medium"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="••••••••"
              required
              minLength={6}
              disabled={loading}
              className="px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white text-base outline-none transition-all focus:border-[#3742fa] focus:shadow-[0_0_0_3px_rgba(55,66,250,0.2)] disabled:opacity-50 placeholder:text-white/30"
            />
          </div>

          {error && (
            <div className="px-3 py-3 bg-[rgba(255,71,87,0.1)] border border-[rgba(255,71,87,0.3)] rounded-lg text-[#ff4757] text-sm">
              {error}
            </div>
          )}
          {message && (
            <div className="px-3 py-3 bg-[rgba(46,213,115,0.1)] border border-[rgba(46,213,115,0.3)] rounded-lg text-[#2ed573] text-sm">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="py-3.5 bg-gradient-to-r from-[#3742fa] to-[#5a67fa] border-none rounded-lg text-white text-base font-semibold cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(55,66,250,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none min-h-[44px]"
            disabled={loading}
          >
            {loading ? "Loading..." : mode === "signin" ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <p className="text-center text-white/50 text-sm mt-6">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="bg-transparent border-none text-[#3742fa] text-sm cursor-pointer underline hover:text-[#5a67fa]"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("signin")}
                className="bg-transparent border-none text-[#3742fa] text-sm cursor-pointer underline hover:text-[#5a67fa]"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
