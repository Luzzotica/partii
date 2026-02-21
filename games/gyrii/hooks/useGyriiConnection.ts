/**
 * Unified Gyrii connection hook.
 * Uses the new Rust server when NEXT_PUBLIC_GYRII_USE_NEW_SERVER=true,
 * otherwise uses SpacetimeDB.
 */

import {
  activateSpacetimeDB,
  deactivateSpacetimeDB,
  useSpacetimeDB,
} from "./useSpacetimeDB";
import {
  activateGyriiServer,
  deactivateGyriiServer,
  useGyriiServer,
} from "./useGyriiServer";

const USE_NEW_SERVER = process.env.NEXT_PUBLIC_GYRII_USE_NEW_SERVER === "true";

export function activateGyriiConnection() {
  if (USE_NEW_SERVER) {
    activateGyriiServer();
  } else {
    activateSpacetimeDB();
  }
}

export function deactivateGyriiConnection() {
  if (USE_NEW_SERVER) {
    deactivateGyriiServer();
  } else {
    deactivateSpacetimeDB();
  }
}

export function useGyriiConnection() {
  if (USE_NEW_SERVER) {
    return useGyriiServer();
  }
  return useSpacetimeDB();
}
