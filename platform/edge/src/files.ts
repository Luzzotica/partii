// File storage: R2 when the edge has it, Workers KV otherwise (staging until
// R2 is enabled on the account). KV caps a value at 25 MB, so bigger files
// are stored as chunks under `~chunks/<key>/<n>` and streamed back in order.
// Handlers only see this small interface.

export interface StoredFile {
  body: ReadableStream;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface Files {
  get(key: string): Promise<StoredFile | null>;
  put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string; contentDisposition?: string }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Size of a stored file, or null if it isn't there. */
  head(key: string): Promise<{ size: number } | null>;
  list(prefix: string): Promise<{ key: string; size: number; uploaded: number }[]>;
}

export const KV_MAX = 25 * 1024 * 1024;
/** Chunk size for big files on KV (under the 25 MB value cap). */
export const KV_CHUNK = 24 * 1024 * 1024;
const chunkKey = (key: string, n: number) => `~chunks/${key}/${n}`;

type KvMeta = { size: number; uploaded: number; chunks?: number };

export function files(env: { FILES?: R2Bucket; FILES_KV?: KVNamespace }): Files {
  if (env.FILES) {
    const r2 = env.FILES;
    return {
      async get(key) {
        const o = await r2.get(key);
        return o ? { body: o.body, size: o.size, text: () => o.text(), arrayBuffer: () => o.arrayBuffer() } : null;
      },
      async put(key, data, opts) {
        await r2.put(key, data, { httpMetadata: { contentType: opts?.contentType, contentDisposition: opts?.contentDisposition } });
      },
      async delete(key) {
        await r2.delete(key);
      },
      async head(key) {
        const o = await r2.head(key);
        return o ? { size: o.size } : null;
      },
      async list(prefix) {
        const r = await r2.list({ prefix });
        return r.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() }));
      },
    };
  }
  if (!env.FILES_KV) throw new Error("no file storage bound (FILES or FILES_KV)");
  const kv = env.FILES_KV;
  return {
    async get(key) {
      const r = await kv.getWithMetadata<KvMeta>(key, "arrayBuffer");
      if (r.value === null) return null;
      const chunks = r.metadata?.chunks;
      if (!chunks) {
        const buf = r.value;
        return {
          body: new Response(buf).body!,
          size: buf.byteLength,
          text: async () => new TextDecoder().decode(buf),
          arrayBuffer: async () => buf,
        };
      }
      const size = r.metadata!.size;
      const read = async (n: number) => {
        const part = await kv.get(chunkKey(key, n), "arrayBuffer");
        if (!part) throw new Error(`file ${key} is missing chunk ${n}`);
        return new Uint8Array(part);
      };
      const all = async () => {
        const out = new Uint8Array(size);
        for (let n = 0, at = 0; n < chunks; n++) {
          const part = await read(n);
          out.set(part, at);
          at += part.byteLength;
        }
        return out.buffer;
      };
      let next = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          if (next >= chunks) return ctl.close();
          ctl.enqueue(await read(next++));
        },
      });
      return { body, size, text: async () => new TextDecoder().decode(await all()), arrayBuffer: all };
    },
    async put(key, data) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
      const size = bytes.byteLength;
      const old = await kv.getWithMetadata<KvMeta>(key, "arrayBuffer");
      if (size <= KV_MAX) {
        await kv.put(key, data, { metadata: { size, uploaded: Date.now() } satisfies KvMeta });
      } else {
        const chunks = Math.ceil(size / KV_CHUNK);
        for (let n = 0; n < chunks; n++) await kv.put(chunkKey(key, n), bytes.subarray(n * KV_CHUNK, Math.min(size, (n + 1) * KV_CHUNK)));
        // The marker goes last: a reader never sees a file whose chunks aren't all there.
        await kv.put(key, "", { metadata: { size, uploaded: Date.now(), chunks } satisfies KvMeta });
      }
      const was = old.metadata?.chunks ?? 0;
      const now = size > KV_MAX ? Math.ceil(size / KV_CHUNK) : 0;
      for (let n = now; n < was; n++) await kv.delete(chunkKey(key, n));
    },
    async head(key) {
      const r = await kv.getWithMetadata<KvMeta>(key, "arrayBuffer");
      if (r.value === null) return null;
      return { size: r.metadata?.size ?? r.value.byteLength };
    },
    async delete(key) {
      const r = await kv.getWithMetadata<KvMeta>(key, "arrayBuffer");
      await kv.delete(key);
      for (let n = 0; n < (r.metadata?.chunks ?? 0); n++) await kv.delete(chunkKey(key, n));
    },
    async list(prefix) {
      const r = await kv.list<KvMeta>({ prefix });
      return r.keys.filter((k) => !k.name.startsWith("~chunks/")).map((k) => ({ key: k.name, size: k.metadata?.size ?? 0, uploaded: k.metadata?.uploaded ?? 0 }));
    },
  };
}
