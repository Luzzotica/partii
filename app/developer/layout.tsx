import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDeveloperFromCookie } from "@/lib/api/developerAuth";

export const metadata = { title: "Developer" };

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const path = hdrs.get("x-invoke-path") ?? hdrs.get("next-url") ?? "";
  const isAuthRoute = path.includes("/developer/login") || path.includes("/developer/signup");

  const dev = await getDeveloperFromCookie();
  if (!dev && !isAuthRoute) redirect("/developer/login");

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/developer" className="font-semibold">Multiplayer Platform</Link>
          {dev && (
            <nav className="flex items-center gap-4 text-sm text-white/70">
              <Link href="/developer" className="hover:text-white">Dashboard</Link>
              <Link href="/developer/keys" className="hover:text-white">API Keys</Link>
              <Link href="/developer/usage" className="hover:text-white">Usage</Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {dev ? (
            <>
              <span className="text-white/60">{dev.email}</span>
              <form action="/api/developer/auth/logout" method="post">
                <button type="submit" className="text-white/60 hover:text-white">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/developer/login" className="text-white/60 hover:text-white">Log in</Link>
              <Link href="/developer/signup" className="text-white/60 hover:text-white">Sign up</Link>
            </>
          )}
        </div>
      </header>
      <main className="px-6 py-8 max-w-4xl mx-auto">{children}</main>
    </div>
  );
}
