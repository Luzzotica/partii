import Link from "next/link";
import { CopyPromptButton } from "@/components/docs/CopyPromptButton";

export default function DocsPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4 pt-6">
        <h1 className="text-4xl font-semibold tracking-tight leading-tight">
          Build a multiplayer game
          <br />
          <span className="text-emerald-300">in under an hour.</span>
        </h1>
        <p className="text-white/70 text-lg leading-relaxed max-w-xl">
          Lobbii is rooms, matchmaking, WebRTC signaling, and TURN relays for games on any
          engine — browser, Godot, Unity, Unreal, native. You don&apos;t read these docs; your AI
          does. Paste one prompt into Claude, Cursor, or ChatGPT and it builds the whole
          multiplayer client for your stack.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Three steps</h2>
        <ol className="space-y-3 text-white/75">
          <li className="flex gap-3">
            <span className="text-emerald-300 font-mono">1.</span>
            <span>
              <Link href="/developer" className="text-blue-300 hover:underline">Create a project</Link>{" "}
              and copy your API key. No payment, no configuration — the key alone is a complete setup.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-emerald-300 font-mono">2.</span>
            <span>Copy the AI prompt below (or the key-included version from your dashboard) and paste it into your AI coding tool. Tell it your engine.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-emerald-300 font-mono">3.</span>
            <span>Run what it builds. Rooms, join codes, peer-to-peer data channels, relay fallback for hostile networks, and self-healing reconnection — all included.</span>
          </li>
        </ol>
        <div className="pt-2">
          <CopyPromptButton />
        </div>
      </section>

      <section className="grid sm:grid-cols-3 gap-4">
        {[
          {
            title: "Connections that survive",
            body: "STUN, self-hosted TURN, and Cloudflare TLS relays on port 443 — corporate Wi-Fi, campus networks, and cellular all connect. Recovery ladder built into the prompt: ICE restarts, then full renegotiation with fresh relays.",
          },
          {
            title: "Any engine, one protocol",
            body: "Plain HTTP/JSON signaling plus an optional WebSocket push channel. The same spec drives browser TypeScript, GDScript, C#, C++, Swift — the AI writes the idiomatic version for yours.",
          },
          {
            title: "Zero required setup",
            body: "No accounts for your players, no OAuth for you. Optional hardening (origin allowlists, attestation, token enforcement) exists when your game is big enough to need it.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <h3 className="font-semibold text-white/90">{c.title}</h3>
            <p className="text-sm text-white/60 leading-relaxed">{c.body}</p>
          </div>
        ))}
      </section>

      <section className="text-sm text-white/50 space-y-1">
        <p>
          Prefer reading the wire spec yourself? It&apos;s at{" "}
          <Link href="/docs/protocol" className="text-blue-300 hover:underline">/docs/protocol</Link>.
          Pricing is <Link href="/docs/pricing" className="text-blue-300 hover:underline">free to start, $5/mo when you grow</Link>.
        </p>
      </section>
    </div>
  );
}
