import Link from "next/link";

export const metadata = { title: "Lobbii Pricing" };

const TIERS = [
  {
    name: "Free",
    price: "$0",
    blurb: "Everything you need to build and playtest.",
    rows: ["1 project, 1 API key", "120 rooms/hour", "50 concurrent rooms", "600 signals/min", "5 GB relay bandwidth/mo"],
    note: "Past the relay allowance, relayed connections pause until next month — direct peer-to-peer keeps working.",
  },
  {
    name: "Pro",
    price: "$5/mo",
    blurb: "One subscription for your whole account.",
    rows: ["Unlimited projects & API keys", "1,200 rooms/hour", "500 concurrent rooms", "6,000 signals/min", "25 GB relay bandwidth/mo per project"],
    note: "Relay overage metered at $0.10/GB. Upgrade from any project page in the dashboard.",
    highlight: true,
  },
];

const FAQ = [
  {
    q: "What actually costs money here?",
    a: "Only relay (TURN) bandwidth — used by the ~15–20% of connections that can't go direct (strict NATs, corporate networks). Signaling, rooms, and STUN are effectively free to serve, so the flat fee stays tiny.",
  },
  {
    q: "Do my players need accounts or logins?",
    a: "No. Players click play. Rooms use join codes; identity is anonymous unless your game is on Steam, where ownership is verified silently.",
  },
  {
    q: "Is any security setup required?",
    a: "No — an API key alone is a complete setup. Origin allowlists, Turnstile attestation, and token enforcement are optional hardening you can enable per project once your game is popular enough to attract abuse.",
  },
  {
    q: "What happens if I cancel Pro?",
    a: "The project drops back to Free limits at the end of the billing period. Nothing breaks; quotas just shrink.",
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-white/60 mt-2">Free to build. $5/month for your whole account when you grow.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`rounded-xl border p-5 space-y-4 ${
              t.highlight ? "border-emerald-400/40 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{t.name}</h2>
              <span className={`text-2xl font-semibold ${t.highlight ? "text-emerald-300" : ""}`}>{t.price}</span>
            </div>
            <p className="text-sm text-white/60">{t.blurb}</p>
            <ul className="space-y-1.5 text-sm text-white/75">
              {t.rows.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className={t.highlight ? "text-emerald-300" : "text-white/40"}>✓</span> {r}
                </li>
              ))}
            </ul>
            <p className="text-xs text-white/45">{t.note}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">FAQ</h2>
        <div className="space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="font-semibold text-white/90">{f.q}</h3>
              <p className="text-sm text-white/60 mt-1 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-sm text-white/50">
        Ready? <Link href="/developer" className="text-blue-300 hover:underline">Create a project</Link> and{" "}
        <Link href="/docs" className="text-blue-300 hover:underline">copy the AI prompt</Link>.
      </p>
    </div>
  );
}
