import { useMemo } from "react";
import { usePartiiPlayer } from "../../../src/player";

/**
 * The shared death screen treats a partii guest as a signed-in player, so a
 * finished run is saved without a separate account step.
 * The user object stays the same for a given player id. The menu effect
 * lists `user` as a dependency, and a fresh object every render refetches
 * the board until the browser runs out of sockets.
 */
export function useAuth() {
  const player = usePartiiPlayer();
  const user = useMemo(
    () => (player ? { id: player.id } : null),
    [player?.id],
  );
  return {
    user,
    signOut: async () => {},
    loading: false,
  };
}
