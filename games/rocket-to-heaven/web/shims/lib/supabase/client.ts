/**
 * The menu leaderboard calls createClient() on every render and lists it
 * as an effect dependency. Return one object so that effect does not loop.
 */
type ProfileRow = { display_name: string | null; id: string };

const chain = {
  select(_columns?: string) {
    return chain;
  },
  eq(_column?: string, _value?: string) {
    return chain;
  },
  insert(_row?: unknown) {
    return chain;
  },
  async single(): Promise<{ data: ProfileRow | null; error: null }> {
    return { data: null, error: null };
  },
};

const client = {
  from(_table?: string) {
    return chain;
  },
};

export function createClient() {
  return client;
}
