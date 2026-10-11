// Publishable keys: `pk_<project>_<keyid>_<sig>`. The signature is an HMAC
// over the project and key id with KEY_SECRET, so the hot path verifies a
// key without touching the database (docs/DESIGN.md, "Live connections").
// Revocation is a cached list checked separately (control plane).

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(sig).slice(0, 22);
}

const ID = /^[a-z0-9]{1,32}$/;

export async function signKey(secret: string, project: string, keyId: string): Promise<string> {
  if (!ID.test(project) || !ID.test(keyId)) throw new Error("project and key id must be [a-z0-9]{1,32}");
  return `pk_${project}_${keyId}_${await hmac(secret, `pk:${project}:${keyId}`)}`;
}

export interface KeyClaims {
  project: string;
  keyId: string;
}

/** The key's project and id when its signature checks out, else null. */
export async function verifyKey(secret: string, key: unknown): Promise<KeyClaims | null> {
  if (typeof key !== "string") return null;
  const m = /^pk_([a-z0-9]{1,32})_([a-z0-9]{1,32})_([A-Za-z0-9_-]{22})$/.exec(key);
  if (!m) return null;
  const [, project, keyId, sig] = m;
  const want = await hmac(secret, `pk:${project}:${keyId}`);
  // Constant-time compare.
  let diff = want.length ^ sig.length;
  for (let i = 0; i < Math.min(want.length, sig.length); i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { project, keyId } : null;
}
