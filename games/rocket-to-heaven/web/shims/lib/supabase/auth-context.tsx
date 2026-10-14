import { usePartiiPlayer } from "../../../src/player";

/**
 * The shared death and victory screens treat a partii guest as a signed-in
 * player, so a finished run is saved without a separate account step.
 */
export function useAuth() {
  const player = usePartiiPlayer();
  return {
    user: player ? { id: player.id } : null,
    signOut: async () => {},
    loading: false,
  };
}
