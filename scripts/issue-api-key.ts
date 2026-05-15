/**
 * Issue a new API key bound to a project. Prints the secret to stdout;
 * paste it into a client's VITE_MP_API_KEY (or equivalent).
 *
 * Usage:
 *   npx tsx scripts/issue-api-key.ts --project-id <uuid> [--name "My key"]
 *   npx tsx scripts/issue-api-key.ts --user-email me@example.com --project-slug bouncy-blobs [--name "Prod"]
 *
 * If a --user-email + --project-slug pair is given, the script will find or
 * create that project under the matching auth.users row.
 */
import { createClient } from "@supabase/supabase-js";
import { generateApiKey } from "../lib/api/crypto";
import { config } from "dotenv";
import { resolve } from "node:path";

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

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";
}

async function resolveProjectId(): Promise<string> {
  const direct = arg("project-id");
  if (direct) return direct;

  const email = arg("user-email");
  if (!email) {
    console.error("Provide either --project-id <uuid> or --user-email <email> [--project-slug <slug>]");
    process.exit(1);
  }

  const { data: list, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`Failed to list users: ${error.message}`);
  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No auth.users row found for ${email}. Sign up on the arcade first.`);

  const slug = slugify(arg("project-slug") ?? "default");
  const projectName = arg("project-name") ?? slug;

  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", user.id)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    console.error(`Using existing project ${slug} (${existing.id}) for ${email}`);
    return existing.id;
  }

  const { data: created, error: createErr } = await admin
    .from("projects")
    .insert({ user_id: user.id, name: projectName, slug })
    .select("id")
    .single();
  if (createErr || !created) throw new Error(`Failed to create project: ${createErr?.message}`);
  console.error(`✓ Created project ${slug} (${created.id}) for ${email}`);
  return created.id;
}

async function main() {
  const projectId = await resolveProjectId();
  const name = arg("name") ?? "Untitled key";

  const { secret, hash, prefix } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ project_id: projectId, key_prefix: prefix, key_hash: hash, name })
    .select("id, key_prefix, name, created_at")
    .single();
  if (error) throw new Error(`Failed to insert api_key: ${error.message}`);

  console.error(`\n✓ Created api_key '${data.name}' (id=${data.id}, prefix=${data.key_prefix})`);
  console.error("Paste the line below into your client's env (e.g. bouncy-blobs/.env):\n");
  console.log(`VITE_MP_API_KEY=${secret}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
