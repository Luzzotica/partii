import type {
  CreateRoomResult,
  IncomingSignal,
  JoinRoomResult,
  PartyClientConfig,
  PollSignalsResult,
  RoomSummary,
  SignalType,
} from "./types";

// SignalingService — REST client for /api/rooms/** with a polling signal loop.
//
// Usage (host):
//   const svc = new SignalingService({ baseUrl, apiKey });
//   const room = await svc.createRoom({ game_id: "hexii" });
//   svc.hostSecret = room.host_secret;
//   svc.peerId     = room.host_peer_id;
//   svc.startPolling(room.room_id, room.host_peer_id, onSignal);
//
// Usage (controller):
//   const svc = new SignalingService({ baseUrl, apiKey });
//   const join = await svc.joinRoom(roomId, { kind: "controller" });
//   svc.peerSecret = join.peer_secret;
//   svc.peerId     = join.peer_id;
//   svc.startPolling(roomId, join.peer_id, onSignal);

export class SignalingService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;

  /** Set on the host side after createRoom(). */
  public hostSecret: string | null = null;
  /** Set after joinRoom() on controllers. */
  public peerSecret: string | null = null;
  /** Set after create/join. Used as `sender_peer_id` on signal POSTs. */
  public peerId: string | null = null;

  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private isPolling = false;
  private sinceId = 0;

  constructor(config: PartyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
  }

  // ─── Room lifecycle ─────────────────────────────────────────────────────────

  async listRooms(gameId?: string): Promise<RoomSummary[]> {
    const qs = gameId ? `?game_id=${encodeURIComponent(gameId)}` : "";
    const res = (await this.get(`/api/rooms${qs}`)) as { rooms: RoomSummary[] };
    return res.rooms;
  }

  async createRoom(options: {
    game_id: string;
    display_name?: string;
    host_kind?: string;
    host_display_name?: string;
    host_metadata?: Record<string, unknown>;
    max_peers?: number;
    password?: string;
    visibility?: "public" | "private";
    metadata?: Record<string, unknown>;
  }): Promise<CreateRoomResult> {
    const r = (await this.post("/api/rooms", options)) as CreateRoomResult;
    this.hostSecret = r.host_secret;
    this.peerId = r.host_peer_id;
    return r;
  }

  async joinRoom(
    roomId: string,
    options: {
      kind: string;
      display_name?: string;
      password?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<JoinRoomResult> {
    const r = (await this.post(
      `/api/rooms/${encodeURIComponent(roomId)}/peers`,
      options,
    )) as JoinRoomResult;
    this.peerSecret = r.peer_secret;
    this.peerId = r.peer_id;
    return r;
  }

  async endRoom(roomId: string): Promise<void> {
    if (!this.hostSecret) throw new Error("hostSecret not set");
    await this.patch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      host_secret: this.hostSecret,
      status: "ended",
    });
  }

  async leaveRoom(roomId: string): Promise<void> {
    if (!this.peerSecret || !this.peerId) throw new Error("not a peer in this room");
    await this.fetchJson(
      `/api/rooms/${encodeURIComponent(roomId)}/peers/${encodeURIComponent(this.peerId)}`,
      { method: "DELETE", body: { peer_secret: this.peerSecret } },
    );
  }

  // ─── Signaling ──────────────────────────────────────────────────────────────

  async sendSignal(
    roomId: string,
    recipientPeerId: string,
    signalType: SignalType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      recipient_peer_id: recipientPeerId,
      signal_type: signalType,
      payload,
    };
    if (this.hostSecret) {
      body.host_secret = this.hostSecret;
    } else if (this.peerSecret && this.peerId) {
      body.peer_secret = this.peerSecret;
      body.sender_peer_id = this.peerId;
    } else {
      throw new Error("neither hostSecret nor peerSecret is set");
    }
    await this.post(`/api/rooms/${encodeURIComponent(roomId)}/signals`, body);
  }

  startPolling(
    roomId: string,
    recipientPeerId: string,
    onSignal: (signal: IncomingSignal) => void,
  ): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.sinceId = 0;

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const path =
          `/api/rooms/${encodeURIComponent(roomId)}/signals` +
          `?recipient_peer_id=${encodeURIComponent(recipientPeerId)}` +
          `&since_id=${this.sinceId}` +
          `&limit=50`;
        const result = (await this.get(path)) as PollSignalsResult;
        for (const sig of result.signals) onSignal(sig);
        this.sinceId = result.next_since_id;
      } catch (err) {
        console.warn("[SignalingService] poll error:", err);
      }
      if (this.isPolling) {
        this.pollingTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    void poll();
  }

  stopPolling(): void {
    this.isPolling = false;
    if (this.pollingTimer !== null) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────────

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "X-API-Key": this.apiKey, ...extra };
  }

  private async fetchJson(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: this.headers(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(`${init.method} ${path} → ${res.status}: ${b?.error ?? res.statusText}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  private get(path: string): Promise<unknown> {
    return this.fetchJson(path, { method: "GET" });
  }
  private post(path: string, body: unknown): Promise<unknown> {
    return this.fetchJson(path, { method: "POST", body });
  }
  private patch(path: string, body: unknown): Promise<unknown> {
    return this.fetchJson(path, { method: "PATCH", body });
  }
}
