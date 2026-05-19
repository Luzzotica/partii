// Party WebRTC SDK — shared types.
// Mirrors the live REST API (rooms/peers under /api/rooms/**).

export type RoomStatus = "waiting" | "active" | "ended";
export type PeerStatus = "joined" | "connected" | "disconnected";
export type SignalType = "offer" | "answer" | "ice_candidate";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CreateRoomResult {
  room_id: string;
  join_code: string;
  host_secret: string;
  host_peer_id: string;
  host_peer_secret: string;
  expires_at: string;
  ice_servers: IceServer[];
}

export interface JoinRoomResult {
  peer_id: string;
  peer_secret: string;
  slot: number;
  kind: string;
  display_name: string;
  ice_servers: IceServer[];
}

export interface RoomSummary {
  room_id: string;
  join_code: string;
  game_id: string;
  display_name: string;
  status: RoomStatus;
  max_peers: number;
  peer_count: number;
  is_password_protected: boolean;
  visibility: "public" | "private";
  joinable: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

export interface IncomingSignal {
  signal_id: number;
  sender_peer_id: string;
  signal_type: SignalType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PollSignalsResult {
  signals: IncomingSignal[];
  next_since_id: number;
}

// ─── Client config + callbacks ────────────────────────────────────────────────

export interface PartyClientConfig {
  /** Base URL of the Next.js deployment, e.g. "https://hexii.vercel.app". */
  baseUrl: string;
  /** REST API key (X-API-Key). */
  apiKey: string;
  /** Poll interval for signals in ms. Default 1500. */
  pollIntervalMs?: number;
}

export interface HostCallbacks {
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onMessage?: (peerId: string, data: string | ArrayBuffer) => void;
  onError?: (err: Error) => void;
}

export interface ControllerCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMessage?: (data: string | ArrayBuffer) => void;
  onError?: (err: Error) => void;
}
