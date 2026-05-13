import { SignalingService } from "./SignalingService";
import type {
  Signal,
  HostCallbacks,
  ControllerCallbacks,
  CreateSessionResult,
  JoinSessionResult,
  PartyClientConfig,
} from "./types";

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// HostWebRTCManager
//
// Manages one RTCPeerConnection + RTCDataChannel per connected player.
// Call connectToPlayer(playerId) when a new player appears in the session.
// Pass signals from the polling loop to handleSignal().
// ─────────────────────────────────────────────────────────────────────────────

export class HostWebRTCManager {
  private readonly signaling: SignalingService;
  private readonly sessionId: string;
  private readonly callbacks: HostCallbacks;
  private readonly rtcConfig: RTCConfiguration;

  private peers: Map<string, RTCPeerConnection> = new Map();
  private channels: Map<string, RTCDataChannel> = new Map();

  constructor(
    sessionId: string,
    signaling: SignalingService,
    callbacks: HostCallbacks = {},
    rtcConfig: RTCConfiguration = DEFAULT_RTC_CONFIG,
  ) {
    this.sessionId = sessionId;
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.rtcConfig = rtcConfig;
  }

  async handleSignal(signal: Signal): Promise<void> {
    const { sender_id, signal_type, payload } = signal;
    const pc = this.peers.get(sender_id);
    if (!pc) return;

    try {
      if (signal_type === "answer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(payload as RTCSessionDescriptionInit),
        );
      } else if (signal_type === "ice_candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit));
      }
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async connectToPlayer(playerId: string): Promise<void> {
    if (this.peers.has(playerId)) return;

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peers.set(playerId, pc);

    const dc = pc.createDataChannel("game-input", { ordered: true });
    this.channels.set(playerId, dc);

    dc.onopen = () => this.callbacks.onPlayerConnected?.(playerId);
    dc.onclose = () => this.callbacks.onPlayerDisconnected?.(playerId);
    dc.onmessage = (e) => this.callbacks.onMessage?.(playerId, e.data);

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await this.signaling.sendSignal(
          this.sessionId,
          playerId,
          "ice_candidate",
          event.candidate.toJSON() as Record<string, unknown>,
        );
      } catch (err) {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.callbacks.onPlayerDisconnected?.(playerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signaling.sendSignal(this.sessionId, playerId, "offer", {
        type: offer.type,
        sdp: offer.sdp,
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  send(playerId: string, data: string | ArrayBuffer): void {
    const dc = this.channels.get(playerId);
    if (dc?.readyState === "open") dc.send(data as string);
  }

  broadcast(data: string | ArrayBuffer): void {
    for (const [playerId] of this.channels) {
      this.send(playerId, data);
    }
  }

  getConnectedPlayers(): string[] {
    return [...this.channels.entries()]
      .filter(([, dc]) => dc.readyState === "open")
      .map(([id]) => id);
  }

  dispose(): void {
    this.signaling.stopPolling();
    for (const [, pc] of this.peers) pc.close();
    this.peers.clear();
    this.channels.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ControllerWebRTCManager
//
// Manages a single RTCPeerConnection to the host.
// Call startListening() after joining the session.
// ─────────────────────────────────────────────────────────────────────────────

export class ControllerWebRTCManager {
  private readonly signaling: SignalingService;
  private readonly sessionId: string;
  private readonly playerId: string;
  private readonly callbacks: ControllerCallbacks;
  private readonly rtcConfig: RTCConfiguration;

  private pc: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;

  constructor(
    sessionId: string,
    playerId: string,
    signaling: SignalingService,
    callbacks: ControllerCallbacks = {},
    rtcConfig: RTCConfiguration = DEFAULT_RTC_CONFIG,
  ) {
    this.sessionId = sessionId;
    this.playerId = playerId;
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.rtcConfig = rtcConfig;
  }

  startListening(): void {
    this.pc = new RTCPeerConnection(this.rtcConfig);

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.onopen = () => this.callbacks.onConnected?.();
      this.dataChannel.onclose = () => this.callbacks.onDisconnected?.();
      this.dataChannel.onmessage = (e) => this.callbacks.onMessage?.(e.data);
    };

    this.pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await this.signaling.sendSignal(
          this.sessionId,
          "host",
          "ice_candidate",
          event.candidate.toJSON() as Record<string, unknown>,
        );
      } catch (err) {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    this.signaling.startPolling(this.sessionId, this.playerId, (signal) => {
      this.handleSignal(signal);
    });
  }

  private async handleSignal(signal: Signal): Promise<void> {
    const pc = this.pc;
    if (!pc) return;

    try {
      if (signal.signal_type === "offer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit),
        );
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signaling.sendSignal(this.sessionId, "host", "answer", {
          type: answer.type,
          sdp: answer.sdp,
        });
      } else if (signal.signal_type === "ice_candidate") {
        await pc.addIceCandidate(
          new RTCIceCandidate(signal.payload as RTCIceCandidateInit),
        );
      }
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  send(data: string | ArrayBuffer): void {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(data as string);
    }
  }

  dispose(): void {
    this.signaling.stopPolling();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
