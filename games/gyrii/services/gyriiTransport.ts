/**
 * Low-level WebSocket transport for Gyrii server.
 * Binary only - no text send/receive.
 */

const GYRII_SERVER_WS =
  process.env.NEXT_PUBLIC_GYRII_SERVER_WS || "ws://localhost:4000";

let ws: WebSocket | null = null;
let _identity: string | null = null;
let _isActive = false;
let _isConnecting = false;
let _onMessage: ((data: Uint8Array) => void) | null = null;
let _onConnectStateChange:
  | ((connecting: boolean, connected: boolean) => void)
  | undefined;
let _onConnected: (() => void) | undefined;

function bytesToUuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex.length === 32) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return hex;
}

export function getIdentity(): string | null {
  return _identity;
}

export function isConnected(): boolean {
  return ws != null && ws.readyState === WebSocket.OPEN;
}

export function isConnecting(): boolean {
  return _isConnecting;
}

export function setActive(active: boolean): void {
  _isActive = active;
}

export function sendBinary(data: Uint8Array): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(data);
}

export function onMessage(cb: (data: Uint8Array) => void): void {
  _onMessage = cb;
}

export function connect(
  onConnectStateChange?: (connecting: boolean, connected: boolean) => void,
  onConnected?: () => void,
): void {
  if (!_isActive || ws || _isConnecting) return;
  _onConnectStateChange = onConnectStateChange;
  _onConnected = onConnected;
  _isConnecting = true;
  onConnectStateChange?.(true, false);

  const url = GYRII_SERVER_WS.replace(/^http/, "ws");
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    _isConnecting = false;
    onConnectStateChange?.(false, true);
    onConnected?.();
  };

  ws.onmessage = async (event) => {
    let data: Uint8Array;
    if (event.data instanceof ArrayBuffer) {
      data = new Uint8Array(event.data);
    } else if (event.data instanceof Blob) {
      data = new Uint8Array(await event.data.arrayBuffer());
    } else {
      return;
    }
    _onMessage?.(data);
  };

  ws.onclose = () => {
    _isConnecting = false;
    ws = null;
    _identity = null;
    onConnectStateChange?.(false, false);
    if (_isActive) {
      setTimeout(() => connect(_onConnectStateChange, _onConnected), 3000);
    }
  };

  ws.onerror = () => {
    onConnectStateChange?.(false, false);
  };
}

export function disconnect(): void {
  _isActive = false;
  if (ws) {
    ws.close();
    ws = null;
  }
  _identity = null;
  _onMessage = null;
}

export function setIdentityFromInit(identityBytes: Uint8Array): void {
  _identity = bytesToUuidString(identityBytes);
}
