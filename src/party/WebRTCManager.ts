import { SignalingService } from "./SignalingService";
import type {
  ControllerCallbacks,
  HostCallbacks,
  IceServer,
  IncomingSignal,
} from "./types";

function toRtcConfig(iceServers: IceServer[]): RTCConfiguration {
  return { iceServers };
}

// ─────────────────────────────────────────────────────────────────────────────
// HostWebRTCManager — one RTCPeerConnection + DataChannel per remote peer.
// Caller drives connectToPeer(peerId) and feeds incoming signals into
// handleSignal(). ICE servers come from the create-room response.
// ─────────────────────────────────────────────────────────────────────────────

export class HostWebRTCManager {
  private readonly signaling: SignalingService;
  private readonly roomId: string;
  private readonly callbacks: HostCallbacks;
  private rtcConfig: RTCConfiguration;

  private peers = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();

  constructor(
    roomId: string,
    signaling: SignalingService,
    iceServers: IceServer[],
    callbacks: HostCallbacks = {},
  ) {
    this.roomId = roomId;
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.rtcConfig = toRtcConfig(iceServers);
  }

  updateIceServers(iceServers: IceServer[]): void {
    this.rtcConfig = toRtcConfig(iceServers);
  }

  async handleSignal(signal: IncomingSignal): Promise<void> {
    const pc = this.peers.get(signal.sender_peer_id);
    if (!pc) return;
    try {
      if (signal.signal_type === "answer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit),
        );
      } else if (signal.signal_type === "ice_candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload as RTCIceCandidateInit));
      }
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async connectToPeer(peerId: string): Promise<void> {
    if (this.peers.has(peerId)) return;
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peers.set(peerId, pc);

    const dc = pc.createDataChannel("game-input", { ordered: true });
    this.channels.set(peerId, dc);
    dc.onopen = () => this.callbacks.onPeerConnected?.(peerId);
    dc.onclose = () => this.callbacks.onPeerDisconnected?.(peerId);
    dc.onmessage = (e) => this.callbacks.onMessage?.(peerId, e.data);

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await this.signaling.sendSignal(
          this.roomId,
          peerId,
          "ice_candidate",
          event.candidate.toJSON() as Record<string, unknown>,
        );
      } catch (err) {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.callbacks.onPeerDisconnected?.(peerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signaling.sendSignal(this.roomId, peerId, "offer", {
        type: offer.type,
        sdp: offer.sdp,
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  disconnectPeer(peerId: string): void {
    this.channels.get(peerId)?.close();
    this.channels.delete(peerId);
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
  }

  send(peerId: string, data: string | ArrayBuffer): void {
    const dc = this.channels.get(peerId);
    if (dc?.readyState === "open") dc.send(data as string);
  }

  broadcast(data: string | ArrayBuffer): void {
    for (const peerId of this.channels.keys()) this.send(peerId, data);
  }

  getConnectedPeers(): string[] {
    return [...this.channels.entries()]
      .filter(([, dc]) => dc.readyState === "open")
      .map(([id]) => id);
  }

  dispose(): void {
    this.signaling.stopPolling();
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.channels.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ControllerWebRTCManager — one RTCPeerConnection back to the host.
// Signals from the host arrive via handleSignal(). The controller answers,
// then sends ICE candidates back through the SignalingService.
// ─────────────────────────────────────────────────────────────────────────────

export class ControllerWebRTCManager {
  private readonly signaling: SignalingService;
  private readonly roomId: string;
  /** The host's peer_id in the room — usually room.host_peer_id from the create response. */
  private readonly hostPeerId: string;
  private readonly callbacks: ControllerCallbacks;
  private rtcConfig: RTCConfiguration;

  private pc: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;

  constructor(
    roomId: string,
    hostPeerId: string,
    signaling: SignalingService,
    iceServers: IceServer[],
    callbacks: ControllerCallbacks = {},
  ) {
    this.roomId = roomId;
    this.hostPeerId = hostPeerId;
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.rtcConfig = toRtcConfig(iceServers);
  }

  updateIceServers(iceServers: IceServer[]): void {
    this.rtcConfig = toRtcConfig(iceServers);
  }

  start(): void {
    if (this.pc) return;
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
          this.roomId,
          this.hostPeerId,
          "ice_candidate",
          event.candidate.toJSON() as Record<string, unknown>,
        );
      } catch (err) {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };
  }

  async handleSignal(signal: IncomingSignal): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (signal.signal_type === "offer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit),
        );
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signaling.sendSignal(this.roomId, this.hostPeerId, "answer", {
          type: answer.type,
          sdp: answer.sdp,
        });
      } else if (signal.signal_type === "ice_candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload as RTCIceCandidateInit));
      }
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  send(data: string | ArrayBuffer): void {
    if (this.dataChannel?.readyState === "open") this.dataChannel.send(data as string);
  }

  dispose(): void {
    this.signaling.stopPolling();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
