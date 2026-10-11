// The partii engine (wasm) for this page: one per page, loaded on demand.
export interface EngineEvent {
  ev: string;
  [k: string]: any;
}

export interface Engine {
  poll(): EngineEvent[];
  join(code: string, kind: string, name: string, meta: unknown): number;
  send(to: number, reliable: boolean, bytes: Uint8Array): void;
  leave(): void;
  online(): boolean;
}

export async function startEngine(edge: string, key: string, playerToken: string | null): Promise<Engine> {
  // Served next to the page (public/engine), not bundled.
  const url = new URL("/engine/partii_engine.js", location.href).href;
  const mod: any = await import(/* @vite-ignore */ url);
  await mod.default();
  const e = new mod.WebEngine(JSON.stringify({ edge, key, conn: "", client: `controller/${navigator.userAgent.includes("Mobile") ? "phone" : "web"}`, player_token: playerToken, no_webrtc: false }));
  return {
    poll: () => JSON.parse(e.poll()),
    join: (code, kind, name, meta) => e.join(code, kind, name, JSON.stringify(meta)),
    send: (to, reliable, bytes) => e.send(to, reliable, bytes),
    leave: () => e.leave(),
    online: () => e.online(),
  };
}

/** One input frame (docs/CONTROLLER.md). */
export function inputFrame(seq: number, lx: number, ly: number, rx: number, ry: number, buttons: number): Uint8Array {
  const b = new Uint8Array(10);
  const v = new DataView(b.buffer);
  const ax = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127)));
  b[0] = 0x50;
  v.setUint16(1, seq & 0xffff, true);
  v.setInt8(3, ax(lx));
  v.setInt8(4, ax(ly));
  v.setInt8(5, ax(rx));
  v.setInt8(6, ax(ry));
  v.setUint16(7, buttons, true);
  return b;
}

export const BUTTON = { PRIMARY: 1, SECONDARY: 2, START: 4, LEAVE: 8, CONFIRM: 16, BACK: 32 } as const;
