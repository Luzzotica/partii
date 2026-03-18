"use client";

import { useEffect, useState } from "react";

const YOUTUBE_CHANNEL_URL =
  process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_URL ||
  "https://www.youtube.com/@sterlong";

export function YouTubeLink() {
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/youtube")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.subscriberCount != null) {
          setSubscriberCount(data.subscriberCount);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <a
      href={YOUTUBE_CHANNEL_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Subscribe on YouTube"
      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF0000] border border-red-600/50 rounded-lg text-white transition-all hover:bg-red-600 min-h-[44px]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="w-6 h-6 shrink-0"
        fill="currentColor"
      >
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
      {subscriberCount != null && (
        <span className="font-orbitron text-xs font-medium tracking-wide">
          {subscriberCount >= 1000000
            ? `${(subscriberCount / 1000000).toFixed(1)}M`
            : subscriberCount >= 1000
              ? `${(subscriberCount / 1000).toFixed(1)}K`
              : subscriberCount.toLocaleString()}
        </span>
      )}
    </a>
  );
}
