'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function Polling({ intervalMs = 1500 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
