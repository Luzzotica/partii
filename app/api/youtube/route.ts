import { NextResponse } from "next/server";

// Requires .env: YOUTUBE_API_KEY, and either YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE (e.g. sterlong)

export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const channelHandle = process.env.YOUTUBE_CHANNEL_HANDLE || "sterlong";

  if (!apiKey) {
    return NextResponse.json(
      { error: "YouTube API not configured" },
      { status: 503 },
    );
  }

  const filter = channelId
    ? `id=${channelId}`
    : `forHandle=${encodeURIComponent(channelHandle.startsWith("@") ? channelHandle : `@${channelHandle}`)}`;

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&${filter}&key=${apiKey}`,
      { next: { revalidate: 300 } }, // Cache for 5 minutes
    );

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: {
          message?: string;
          reason?: string;
          errors?: Array<{ reason?: string }>;
        };
      };
      const reason =
        errBody.error?.errors?.[0]?.reason ??
        errBody.error?.reason ??
        "unknown";
      const message = errBody.error?.message ?? "Failed to fetch YouTube data";
      console.error("[YouTube API]", res.status, reason, message);
      return NextResponse.json(
        { error: message, reason },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      items?: Array<{ statistics?: { subscriberCount?: string } }>;
    };

    const subscriberCount = data.items?.[0]?.statistics?.subscriberCount;
    const count = subscriberCount ? parseInt(subscriberCount, 10) : null;

    return NextResponse.json({
      subscriberCount: Number.isNaN(count) ? null : count,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch YouTube data" },
      { status: 500 },
    );
  }
}
