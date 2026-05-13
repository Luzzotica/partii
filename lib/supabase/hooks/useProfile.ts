'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/supabase/auth-context';
import { createClient } from '@/lib/supabase/client';

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
};

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile((data as Profile) ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { profile, loading };
}
