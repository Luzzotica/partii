"use client";

import { useState } from "react";
import { buildWebRTCPrompt, API_KEY_PLACEHOLDER } from "@/lib/devPrompt";

/** Copies the full AI build prompt (placeholder-key mode) to the clipboard.
 *  The real-key variant lives in the developer dashboard next to key reveal. */
export function CopyPromptButton({ label = "Copy the AI prompt" }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const prompt = buildWebRTCPrompt({
      apiKey: API_KEY_PLACEHOLDER,
      baseUrl: window.location.origin,
    });
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <button
      onClick={copy}
      className="px-5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-200 font-medium transition-colors"
    >
      {copied ? "Copied — paste it into your AI" : label}
    </button>
  );
}
