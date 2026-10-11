// File storage: R2 when the edge has it, Workers KV otherwise (staging until
// R2 is enabled on the account; KV caps a file at 25 MB). Handlers only see
// this small interface.

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
  list(prefix: string): Promise<{ key: string; size: number; uploaded: number }[]>;
}

export const KV_MAX = 25 * 1024 * 1024;

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
      const r = await kv.getWithMetadata<{ size: number }>(key, "arrayBuffer");
      if (!r.value) return null;
      const buf = r.value;
      return {
        body: new Response(buf).body!,
        size: buf.byteLength,
        text: async () => new TextDecoder().decode(buf),
        arrayBuffer: async () => buf,
      };
    },
    async put(key, data) {
      const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
      if (size > KV_MAX) throw new Error(`files over 25 MB need R2 (enable R2 on the account)`);
      await kv.put(key, data, { metadata: { size, uploaded: Date.now() } });
    },
    async delete(key) {
      await kv.delete(key);
    },
    async list(prefix) {
      const r = await kv.list<{ size: number; uploaded: number }>({ prefix });
      return r.keys.map((k) => ({ key: k.name, size: k.metadata?.size ?? 0, uploaded: k.metadata?.uploaded ?? 0 }));
    },
  };
}
