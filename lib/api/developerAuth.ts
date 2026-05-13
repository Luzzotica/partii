import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "./crypto";

const COOKIE_NAME = "hexii_dev_session";
const admin = createAdminClient();

export type DeveloperContext = {
  developerId: string;
  email: string;
  displayName: string;
};

export async function getDeveloperFromCookie(): Promise<DeveloperContext | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = sha256Hex(token);
  const { data: session } = await admin
    .from("developer_sessions")
    .select("developer_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const { data: dev } = await admin
    .from("developers")
    .select("id, email, display_name")
    .eq("id", session.developer_id)
    .maybeSingle();
  if (!dev) return null;

  return { developerId: dev.id, email: dev.email, displayName: dev.display_name ?? "" };
}

export async function setDeveloperSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearDeveloperSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export const DEVELOPER_COOKIE_NAME = COOKIE_NAME;
