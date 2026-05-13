import { NextResponse } from "next/server";
import { clearDeveloperSessionCookie } from "@/lib/api/developerAuth";

export async function POST() {
  await clearDeveloperSessionCookie();
  return NextResponse.json({ ok: true });
}
