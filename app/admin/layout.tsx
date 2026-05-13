import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { UserMenu } from '@/components/auth/UserMenu';

export const metadata = {
  title: 'Admin',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await requireAdmin();
  if (!result.ok) {
    if (result.status === 401) redirect('/?signin=1');
    redirect('/learn');
  }

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="font-semibold">Admin</Link>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <Link href="/admin/courses" className="hover:text-white">Courses</Link>
            <Link href="/admin/offers" className="hover:text-white">Offers</Link>
            <Link href="/admin/users" className="hover:text-white">Users</Link>
            <Link href="/admin/coupons" className="hover:text-white">Coupons</Link>
            <Link href="/admin/broadcasts" className="hover:text-white">Broadcasts</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/learn" className="text-sm text-white/60 hover:text-white">Member Area</Link>
          <UserMenu />
        </div>
      </header>
      <main className="px-6 py-8 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
