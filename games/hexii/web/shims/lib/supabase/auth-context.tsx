/**
 * No partii account yet. Step 2 signs each browser in as a guest.
 * Until then the shared screens treat the player as signed out.
 */
export function useAuth() {
  return {
    user: null as { id: string } | null,
    signOut: async () => {},
    loading: false,
  };
}
