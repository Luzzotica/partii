import Link from 'next/link';
import { UserMenu } from '@/components/auth/UserMenu';

export const metadata = {
  title: 'Changelog',
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] to-[#16213e] text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ← Home
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/arcade" className="text-sm text-white/60 hover:text-white transition-colors">
            Arcade
          </Link>
          <Link href="/developer" className="text-sm text-white/60 hover:text-white transition-colors">
            Developer
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className="px-6 py-10 max-w-3xl mx-auto">{children}</main>
    </div>
  );
}
