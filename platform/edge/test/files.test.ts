import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { files, KV_CHUNK } from "../src/files";

// The KV fallback (staging without R2): files over 25 MB go in chunks.
describe("KV file storage", () => {
  const kv = () => files({ FILES_KV: (env as { FILES_KV: KVNamespace }).FILES_KV });

  it("round-trips a small file", async () => {
    await kv().put("t/small.json", '{"a":1}');
    const f = await kv().get("t/small.json");
    expect(f?.size).toBe(7);
    expect(await f?.text()).toBe('{"a":1}');
  });

  it("chunks a 60 MB file, streams it back in order and hides the chunks", async () => {
    const size = 2 * KV_CHUNK + 1234;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) data[i] = (i / 4096) & 0xff;
    data[size - 1] = 0xab;
    await kv().put("builds/g/big.zip", data);
    const f = await kv().get("builds/g/big.zip");
    expect(f?.size).toBe(size);
    const streamed = new Uint8Array(await new Response(f!.body).arrayBuffer());
    expect(streamed.byteLength).toBe(size);
    expect(streamed[4096 * 7000]).toBe(7000 & 0xff);
    expect(streamed[size - 1]).toBe(0xab);
    const listed = await kv().list("builds/g/");
    expect(listed).toEqual([{ key: "builds/g/big.zip", size, uploaded: expect.any(Number) }]);
    expect((await kv().list("~chunks/")).length).toBe(0);
    const raw = (env as { FILES_KV: KVNamespace }).FILES_KV;
    expect((await raw.list({ prefix: "~chunks/builds/g/big.zip/" })).keys.length).toBe(3);
    // Replacing with a small file and deleting both clean the chunks up.
    await kv().put("builds/g/big.zip", "tiny");
    expect(await (await kv().get("builds/g/big.zip"))!.text()).toBe("tiny");
    expect((await raw.list({ prefix: "~chunks/builds/g/big.zip/" })).keys.length).toBe(0);
    await kv().put("builds/g/big.zip", data);
    await kv().delete("builds/g/big.zip");
    expect(await kv().get("builds/g/big.zip")).toBeNull();
    expect((await raw.list({ prefix: "~chunks/builds/g/big.zip/" })).keys.length).toBe(0);
  }, 30_000); // 60 MB: slow when the whole suite runs in parallel
});
