import { NextResponse } from "next/server";

const DISCORD_INVITE_CODE = "kPufR79dSV";

export async function GET() {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`,
      {
        headers: {
          "User-Agent": "SterlingGames/1.0",
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch Discord data" },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      approximate_member_count?: number;
      approximate_presence_count?: number;
    };

    return NextResponse.json({
      memberCount: data.approximate_member_count ?? null,
      presenceCount: data.approximate_presence_count ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch Discord data" },
      { status: 500 },
    );
  }
}
