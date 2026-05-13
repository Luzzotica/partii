import Link from 'next/link';
import { UserMenu } from '@/components/auth/UserMenu';

export const metadata = {
  title: 'Store',
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] to-[#16213e] text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/store" className="text-lg font-semibold tracking-tight">
          Store
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/learn"
            className="text-sm text-white/60 hover:text-white transition-colors"
          >
            Member Area
          </Link>
          <Link
            href="/arcade"
            className="text-sm text-white/60 hover:text-white transition-colors"
          >
            Arcade
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
