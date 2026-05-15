/**
 * Issue a new API key bound to a developer account. Prints the secret to stdout;
 * paste it into a client's VITE_MP_API_KEY (or equivalent).
 *
 * Usage:
 *   npx tsx scripts/issue-api-key.ts [--name "My key"] [--developer-id <uuid>]
 *
 * If --developer-id is omitted, picks the first developer row in the DB
 * (good enough for solo local dev).
 */
import { createClient } from "@supabase/supabase-js";
import { generateApiKey, hashPassword } from "../lib/api/crypto";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

config({ path: resolve(__dirname, "..", ".env") });
config({ path: resolve(__dirname, "..", ".env.local"), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("name") ?? "Local dev key";
  let developerId = arg("developer-id");

  if (!developerId) {
    const { data, error } = await admin
      .from("developers")
      .select("id, email")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to look up developer: ${error.message}`);
    if (!data) {
      // Bootstrap a developer row so this is fully self-serve for local dev.
      const email = arg("email") ?? "dev@localhost";
      const tempPassword = randomBytes(12).toString("base64url");
      const { data: created, error: createErr } = await admin
        .from("developers")
        .insert({ email, password_hash: hashPassword(tempPassword), display_name: "Local dev" })
        .select("id, email")
        .single();
      if (createErr || !created) throw new Error(`Failed to create developer: ${createErr?.message}`);
      developerId = created.id;
      console.error(`✓ Created developer ${created.email} (${developerId})`);
      console.error(`  Temp password (save this if you want to log into /developer): ${tempPassword}`);
    } else {
      developerId = data.id;
      console.error(`Using developer: ${data.email} (${developerId})`);
    }
  }

  const { secret, hash, prefix } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ developer_id: developerId, key_prefix: prefix, key_hash: hash, name })
    .select("id, key_prefix, name, created_at")
    .single();
  if (error) throw new Error(`Failed to insert api_key: ${error.message}`);

  console.error(`\n✓ Created api_key '${data.name}' (id=${data.id}, prefix=${data.key_prefix})`);
  console.error("Paste the line below into your client's env (e.g. bouncy-blobs/web/.env):\n");
  console.log(`VITE_MP_API_KEY=${secret}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
