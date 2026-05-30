import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireUser";
import { UserMenu } from "@/components/auth/UserMenu";

export const metadata = { title: "Developer" };

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const result = await requireUser();
  if (!result.ok) redirect("/?signin=1");

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/developer" className="font-semibold">Lobbii</Link>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <Link href="/developer" className="hover:text-white">Projects</Link>
            <Link href="/developer/usage" className="hover:text-white">Usage</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/learn" className="text-sm text-white/60 hover:text-white">Member Area</Link>
          <UserMenu />
        </div>
      </header>
      <main className="px-6 py-8 max-w-4xl mx-auto">{children}</main>
    </div>
  );
}
