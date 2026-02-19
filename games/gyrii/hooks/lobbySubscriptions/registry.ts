import type { DbConnection } from "../../generated";
import type { LobbyContext, LobbyEntityDescriptor } from "./types";

const entities: LobbyEntityDescriptor[] = [];
let lastContext: LobbyContext | null = null;

let getConnection: () => DbConnection | null = () => null;
let getIdentity: () => string | null = () => null;

/** Set by useSpacetimeDB so entity modules (e.g. players) can access current connection and identity. */
export function setConnectionGetters(
  conn: () => DbConnection | null,
  identity: () => string | null,
): void {
  getConnection = conn;
  getIdentity = identity;
}

export function getConnectionForSync(): DbConnection | null {
  return getConnection();
}

export function getIdentityForSync(): string | null {
  return getIdentity();
}

export function registerLobbyEntity(descriptor: LobbyEntityDescriptor): void {
  entities.push(descriptor);
}

export function setupAllRowCallbacks(conn: DbConnection): void {
  for (const entity of entities) {
    entity.setupRowCallbacks(conn);
  }
}

function contextEqual(a: LobbyContext | null, b: LobbyContext | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.lobbyId === b.lobbyId && a.worldId === b.worldId;
}

export function syncLobbyEntitySubscriptions(
  conn: DbConnection,
  context: LobbyContext | null,
): void {
  if (context === null) {
    for (const entity of entities) {
      entity.unsubscribe();
    }
    lastContext = null;
    return;
  }
  if (contextEqual(context, lastContext)) return;
  for (const entity of entities) {
    entity.unsubscribe();
  }
  lastContext = context;
  for (const entity of entities) {
    entity.subscribe(conn, context);
  }
}
