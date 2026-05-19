export { SignalingService } from "./SignalingService";
export { HostWebRTCManager, ControllerWebRTCManager } from "./WebRTCManager";
export type {
  RoomStatus,
  PeerStatus,
  SignalType,
  IceServer,
  CreateRoomResult,
  JoinRoomResult,
  RoomSummary,
  IncomingSignal,
  PollSignalsResult,
  PartyClientConfig,
  HostCallbacks,
  ControllerCallbacks,
} from "./types";

import { SignalingService } from "./SignalingService";
import { HostWebRTCManager, ControllerWebRTCManager } from "./WebRTCManager";
import type {
  PartyClientConfig,
  HostCallbacks,
  ControllerCallbacks,
  CreateRoomResult,
  JoinRoomResult,
} from "./types";

// ─── Convenience factories ────────────────────────────────────────────────────

export async function createHostRoom(
  config: PartyClientConfig,
  options: {
    game_id: string;
    display_name?: string;
    host_kind?: string;
    host_display_name?: string;
    host_metadata?: Record<string, unknown>;
    max_peers?: number;
    password?: string;
    visibility?: "public" | "private";
    metadata?: Record<string, unknown>;
  },
  callbacks?: HostCallbacks,
): Promise<{
  result: CreateRoomResult;
  manager: HostWebRTCManager;
  signaling: SignalingService;
}> {
  const signaling = new SignalingService(config);
  const result = await signaling.createRoom(options);

  const manager = new HostWebRTCManager(
    result.room_id,
    signaling,
    result.ice_servers,
    callbacks ?? {},
  );

  signaling.startPolling(result.room_id, result.host_peer_id, (signal) => {
    void manager.handleSignal(signal);
  });

  return { result, manager, signaling };
}

export async function joinAsController(
  config: PartyClientConfig,
  roomId: string,
  hostPeerId: string,
  options: {
    kind: string;
    display_name?: string;
    password?: string;
    metadata?: Record<string, unknown>;
  },
  callbacks?: ControllerCallbacks,
): Promise<{
  result: JoinRoomResult;
  manager: ControllerWebRTCManager;
  signaling: SignalingService;
}> {
  const signaling = new SignalingService(config);
  const result = await signaling.joinRoom(roomId, options);

  const manager = new ControllerWebRTCManager(
    roomId,
    hostPeerId,
    signaling,
    result.ice_servers,
    callbacks ?? {},
  );
  manager.start();

  signaling.startPolling(roomId, result.peer_id, (signal) => {
    void manager.handleSignal(signal);
  });

  return { result, manager, signaling };
}
