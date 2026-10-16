// A test client for the live protocol: a real WebSocket to the edge, with
// helpers to send requests and wait for events.

import { env, SELF } from "cloudflare:test";
import { signKey } from "../src/keys";

export const SECRET = "dev-only-key-secret";

export async function key(project = "demo", keyId = "k1"): Promise<string> {
  return signKey((env as { KEY_SECRET: string }).KEY_SECRET ?? SECRET, project, keyId);
}

let n = 0;
export function newConn(): string {
  return `conn${Date.now().toString(36)}x${(n++).toString(36)}aaaaaaaa`.slice(0, 40);
}

let ipN = 0;
export function newIp(): string {
  ipN++;
  return `10.${(ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`;
}

type Frame = Record<string, any>;

export class Client {
  ws!: WebSocket;
  frames: Frame[] = [];
  waiters: { pred: (f: Frame) => boolean; resolve: (f: any) => void }[] = [];
  private seq = 0;
  closed = false;

  /** Each client gets its own IP unless a test shares one (the rate limits are per IP). */
  constructor(public conn = newConn(), public ip = newIp()) {}

  async open(): Promise<this> {
    const res = await SELF.fetch(`https://edge/v1/connect?conn=${this.conn}`, { headers: { upgrade: "websocket", "cf-connecting-ip": this.ip } });
    if (!res.webSocket) throw new Error(`no websocket: ${res.status} ${await res.text()}`);
    this.ws = res.webSocket;
    (this.ws as any).binaryType = "arraybuffer";
    this.ws.accept();
    this.ws.addEventListener("message", (e) => {
      let f: Frame;
      if (typeof e.data !== "string") f = { __bin: Array.from(new Uint8Array(e.data as ArrayBuffer)) };
      else {
        try {
          f = JSON.parse(e.data);
        } catch {
          f = { __text: e.data };
        }
      }
      const i = this.waiters.findIndex((w) => w.pred(f));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(f);
      else this.frames.push(f);
    });
    this.ws.addEventListener("close", () => (this.closed = true));
    return this;
  }

  send(v: Frame) {
    this.ws.send(JSON.stringify(v));
  }

  /** The next frame matching `pred` (already received or still to come). */
  next<T = Frame>(pred: (f: any) => boolean, ms = 3000): Promise<T> {
    const i = this.frames.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.frames.splice(i, 1)[0] as T);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const k = this.waiters.indexOf(w);
        if (k >= 0) {
          this.waiters.splice(k, 1);
          reject(new Error(`timeout waiting; have ${JSON.stringify(this.frames).slice(0, 400)}`));
        }
      }, ms);
    });
  }

  event(t: string, ms?: number) {
    return this.next((f) => f.t === t, ms);
  }

  /** Send a request and wait for its ok/err reply. */
  async req(v: Frame): Promise<Frame> {
    const id = ++this.seq;
    this.send({ ...v, id });
    return this.next((f) => f.id === id && (f.t === "ok" || f.t === "err"));
  }

  async hello(k?: string, extra: Record<string, unknown> = {}): Promise<Frame> {
    this.send({ t: "hello", v: 1, key: k ?? (await key()), client: "test", ...extra });
    return this.next((f) => f.t === "welcome" || f.t === "err");
  }

  relay(to: number, bytes: number[]) {
    const b = new Uint8Array(3 + bytes.length);
    b[0] = 1;
    new DataView(b.buffer).setUint16(1, to);
    b.set(bytes, 3);
    this.ws.send(b);
  }

  binary(ms?: number): Promise<{ from: number; bytes: number[] }> {
    return this.next((f) => Array.isArray(f.__bin), ms).then((f: Frame) => {
      const b = f.__bin as number[];
      return { from: (b[1] << 8) | b[2], bytes: b.slice(3) };
    });
  }

  close() {
    this.ws.close(1000, "bye");
  }
}

export async function connected(k?: string): Promise<Client> {
  const c = await new Client().open();
  const w = await c.hello(k);
  if (w.t !== "welcome") throw new Error(JSON.stringify(w));
  return c;
}

/** A host with a room and one guest in it. */
export async function roomWithGuest(opts: Record<string, unknown> = {}) {
  const host = await connected();
  const made = await host.req({ t: "create", game: "test", name: "H", ...opts });
  const guest = await connected();
  const joined = await guest.req({ t: "join", code: made.room.code, name: "G" });
  await host.event("member_joined");
  return { host, guest, code: made.room.code as string, joined };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
