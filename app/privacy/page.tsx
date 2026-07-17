import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="text-white/75 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] to-[#16213e] text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ← Home
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/arcade" className="text-sm text-white/60 hover:text-white transition-colors">
            Partii
          </Link>
          <Link href="/developer" className="text-sm text-white/60 hover:text-white transition-colors">
            Studio
          </Link>
          <Link href="/docs" className="text-sm text-white/60 hover:text-white transition-colors">
            Lobbii
          </Link>
        </div>
      </header>
      <main className="px-6 py-10 max-w-3xl mx-auto space-y-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-white/60 mt-2">Last updated: July 3, 2026</p>
        </div>

        <Section title="Overview">
          <p>
            This site and the games published here (on the web, on itch.io, and on Steam) are
            operated by Sterling Long. This policy describes what data is collected when you browse
            the site, play the games, or use the multiplayer services, and how it is used. The short
            version: data is collected only to make the games and services work, it is never sold,
            and there is no third-party advertising or cross-site tracking.
          </p>
        </Section>

        <Section title="Multiplayer &amp; matchmaking">
          <p>
            When you host or join an online match, the multiplayer service stores the room you
            created or joined (room name, join code, player display names you enter, and the game
            being played) and relays the technical handshake messages needed to establish a
            peer-to-peer connection between players. Those handshake messages include network
            addresses (IP addresses), which is inherent to how WebRTC peer-to-peer connections
            work. Handshake messages are deleted within about a minute; rooms are deleted shortly
            after they end.
          </p>
          <p>
            If a direct connection between players is not possible, game traffic is forwarded
            through relay (TURN) servers we operate and through Cloudflare&apos;s relay service.
            Relays forward encrypted game traffic and log only technical session metadata (byte
            counts, timestamps) — never the content of your game session.
          </p>
        </Section>

        <Section title="Connection quality telemetry">
          <p>
            To find and fix connection problems, the games report anonymous technical telemetry
            about each connection attempt: whether it succeeded, how long it took, the connection
            method used (direct or relayed), the coarse browser/platform family (for example
            &quot;chrome&quot; or &quot;ios&quot;), and an anonymous session identifier. This
            telemetry contains no names, no precise device information, and is used solely for
            reliability engineering.
          </p>
        </Section>

        <Section title="Bot protection (Cloudflare Turnstile)">
          <p>
            The multiplayer services use{' '}
            <a
              href="https://www.cloudflare.com/turnstile/"
              className="text-blue-300 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Cloudflare Turnstile
            </a>{' '}
            to verify that connection requests come from a real browser rather than an automated
            script. Turnstile runs invisibly (there is no puzzle to solve) and may process technical
            characteristics of your browser and network to make that determination. Cloudflare acts
            as a data processor for this feature; see the{' '}
            <a
              href="https://www.cloudflare.com/en-gb/turnstile-privacy-policy/"
              className="text-blue-300 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Cloudflare Turnstile Privacy Policy
            </a>{' '}
            for details on what Cloudflare processes.
          </p>
        </Section>

        <Section title="Steam">
          <p>
            If you play a game purchased on Steam, the game verifies your ownership with Valve using
            a Steam session ticket, and your numeric SteamID is used to identify you in multiplayer
            sessions and telemetry. Valve&apos;s handling of your Steam account is governed by the{' '}
            <a
              href="https://store.steampowered.com/privacy_agreement/"
              className="text-blue-300 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Steam Privacy Policy
            </a>
            . We never see your Steam password or payment details.
          </p>
        </Section>

        <Section title="Anonymous device identifier">
          <p>
            Web versions of the games store a randomly generated identifier in your browser&apos;s
            local storage. It links your multiplayer sessions together for abuse prevention and
            reliability metrics, and identifies nothing about you personally. Clearing your browser
            storage resets it.
          </p>
        </Section>

        <Section title="Accounts, purchases &amp; courses">
          <p>
            If you create an account or purchase content, we store the account details you provide
            (email, display name) and your purchase and enrollment records. Payments are processed
            by Stripe — card details never touch our servers. Authentication and data storage are
            provided by Supabase.
          </p>
        </Section>

        <Section title="Service providers">
          <p>The services run on the following infrastructure providers, acting as processors:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Vercel (website and API hosting)</li>
            <li>Supabase (database and authentication)</li>
            <li>Fly.io (multiplayer relay and signaling servers)</li>
            <li>Cloudflare (bot protection and connection relay)</li>
            <li>Stripe (payments)</li>
            <li>Valve / Steam (Steam builds only)</li>
          </ul>
        </Section>

        <Section title="Retention &amp; your choices">
          <p>
            Multiplayer handshake data is deleted within minutes; rooms shortly after they end.
            Telemetry and relay usage metadata are kept only as long as needed for reliability and
            abuse analysis. Account data is kept while your account exists. To ask about, correct,
            or delete data associated with you, email{' '}
            <a href="mailto:ster@sterlinglong.me" className="text-blue-300 hover:underline">
              ster@sterlinglong.me
            </a>
            .
          </p>
        </Section>

        <Section title="Changes">
          <p>
            Material changes to this policy will be noted on the{' '}
            <Link href="/changelog" className="text-blue-300 hover:underline">
              changelog
            </Link>{' '}
            with an updated date above.
          </p>
        </Section>
      </main>
    </div>
  );
}
