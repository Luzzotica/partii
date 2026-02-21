"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/supabase/auth-context";
import { createClient } from "@/lib/supabase/client";
import { AuthModal } from "./AuthModal";
import { useGameStore } from "@/games/hexii/store/gameStore";

export function UserMenu() {
  const { user, loading, signOut } = useAuth();
  const showAuthModal = useGameStore((state) => state.showAuthModal);
  const setAuthModal = useGameStore((state) => state.setAuthModal);
  const [showDropdown, setShowDropdown] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [updating, setUpdating] = useState(false);
  const supabase = createClient();

  // Fetch profile data
  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name || "");
      }
    };

    fetchProfile();
  }, [user, supabase]);

  const startEditingName = () => {
    setNewDisplayName(displayName);
    setEditingName(true);
  };

  const saveDisplayName = async () => {
    if (!user || updating || !newDisplayName.trim()) return;

    setUpdating(true);
    const trimmedName = newDisplayName.trim();

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", user.id);

    if (!error) {
      setDisplayName(trimmedName);
      setEditingName(false);
    }
    setUpdating(false);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNewDisplayName("");
  };

  if (loading) {
    return (
      <div className="w-[100px] h-9 bg-white/10 rounded-lg animate-pulse" />
    );
  }

  if (!user) {
    return (
      <>
        <button
          className="px-5 py-2 bg-gradient-to-r from-[#3742fa] to-[#5a67fa] border-none rounded-lg text-white text-sm font-semibold cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(55,66,250,0.4)] min-h-[44px]"
          onClick={() => setAuthModal(true)}
        >
          Sign In
        </button>
        <AuthModal isOpen={showAuthModal} onClose={() => setAuthModal(false)} />
      </>
    );
  }

  // Use display_name from profile (fetched from DB), fallback to user metadata
  const shownName =
    displayName ||
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Player";
  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white cursor-pointer transition-all hover:bg-white/10 min-h-[44px]"
        onClick={() => setShowDropdown(!showDropdown)}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={28}
            height={28}
            className="w-7 h-7 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3742fa] to-[#5a67fa] flex items-center justify-center text-sm font-semibold">
            {shownName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap hidden sm:inline">
          {shownName}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${showDropdown ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute top-[calc(100%+8px)] right-0 min-w-[200px] bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/10 rounded-xl overflow-hidden z-[101] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <div className="px-4 py-3">
              <span className="text-xs text-white/50">{user.email}</span>
            </div>
            <div className="h-px bg-white/10" />

            {/* Display Name Editor */}
            <div className="px-4 py-3">
              <span className="block text-[0.7rem] text-white/40 uppercase tracking-wider mb-2">
                Display Name
              </span>
              {editingName ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    maxLength={30}
                    className="w-full px-2 py-2 bg-black/30 border border-white/20 rounded-md text-white text-sm outline-none transition-all focus:border-[#3742fa] focus:shadow-[0_0_0_2px_rgba(55,66,250,0.2)]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveDisplayName();
                      if (e.key === "Escape") cancelEditingName();
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveDisplayName}
                      disabled={updating || !newDisplayName.trim()}
                      className="flex-1 px-2 py-1.5 border-none rounded bg-[#3742fa] text-white text-xs cursor-pointer transition-all hover:bg-[#5a67fa] disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditingName}
                      className="flex-1 px-2 py-1.5 border-none rounded bg-white/10 text-white/70 text-xs cursor-pointer transition-all hover:bg-white/15 hover:text-white min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white overflow-hidden text-ellipsis whitespace-nowrap">
                    {shownName}
                  </span>
                  <button
                    onClick={startEditingName}
                    className="bg-transparent border-none text-[#ffa502] text-xs cursor-pointer px-2 py-1 rounded transition-all hover:bg-[rgba(255,165,2,0.1)] min-h-[44px]"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            <div className="h-px bg-white/10" />
            <button
              className="flex items-center gap-3 w-full px-4 py-3 bg-transparent border-none text-white/80 text-sm cursor-pointer transition-all hover:bg-white/5 hover:text-white text-left min-h-[44px]"
              onClick={() => {
                signOut();
                setShowDropdown(false);
              }}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-[18px] h-[18px]"
              >
                <path
                  fillRule="evenodd"
                  d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4.414l-4.293 4.293a1 1 0 01-1.414-1.414L11.586 7H6a1 1 0 110-2h5.586L8.293 1.707a1 1 0 011.414-1.414L14 4.586v2.828z"
                  clipRule="evenodd"
                />
              </svg>
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
