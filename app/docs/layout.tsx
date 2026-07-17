import Link from "next/link";

export const metadata = {
  title: "Lobbii Docs — multiplayer for any engine",
  description:
    "Lobbii is Partii's multiplayer backend: rooms, signaling, and TURN relays for browser, Godot, Unity, Unreal, and native games. Paste one AI prompt, get a working multiplayer client.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] to-[#16213e] text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/docs" className="text-lg font-semibold tracking-tight">
            Lobbii
          </Link>
          <nav className="flex items-center gap-4 text-sm text-white/60">
            <Link href="/docs" className="hover:text-white transition-colors">Quickstart</Link>
            <Link href="/docs/protocol" className="hover:text-white transition-colors">Protocol</Link>
            <Link href="/docs/pricing" className="hover:text-white transition-colors">Pricing</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-white/40">Partii multiplayer</span>
          <Link
            href="/developer"
            className="text-sm px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            Open Studio
          </Link>
        </div>
      </header>
      <main className="px-6 py-10 max-w-3xl mx-auto">{children}</main>
    </div>
  );
}
