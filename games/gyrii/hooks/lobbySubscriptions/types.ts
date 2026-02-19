import type { DbConnection } from "../../generated";

export type LobbyContext = { lobbyId: string; worldId: number };

export type LobbyEntityFilter = "lobby_id" | "world_id";

export interface LobbyEntityDescriptor {
  filter: LobbyEntityFilter;
  /** Table name for reference; used to build WHERE clause. */
  table: string;
  subscribe: (conn: DbConnection, context: LobbyContext) => void;
  unsubscribe: () => void;
  setupRowCallbacks: (conn: DbConnection) => void;
}
