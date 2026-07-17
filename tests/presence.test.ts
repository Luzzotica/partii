import { describe, expect, it, vi } from "vitest";
import { PRESENCE_STALE_SEC } from "@/lib/api/presence";

// Unit-test the pure constants + aggregation shape via a mock client.

describe("presence constants", () => {
  it("stale window is 90 seconds", () => {
    expect(PRESENCE_STALE_SEC).toBe(90);
  });
});

describe("presenceCountsForProject", () => {
  it("aggregates online and playing by game", async () => {
    const { presenceCountsForProject } = await import("@/lib/api/presence");

    const rows = [
      { game_id: "hexii", status: "playing" },
      { game_id: "hexii", status: "online" },
      { game_id: "tankii", status: "playing" },
      { game_id: null, status: "online" },
    ];

    const admin = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.delete = self;
        chain.eq = self;
        chain.lt = self;
        chain.gte = self;
        chain.select = () => ({
          eq: () => ({
            gte: async () => ({ data: rows, error: null }),
          }),
        });
        // For the delete path: .from().delete().eq().lt()
        chain.then = undefined;
        return chain;
      }),
    };

    // Simpler mock: intercept both delete and select chains
    let call = 0;
    const admin2 = {
      from: () => {
        call += 1;
        if (call === 1) {
          // delete stale
          return {
            delete: () => ({
              eq: () => ({
                lt: async () => ({ error: null }),
              }),
            }),
          };
        }
        // select
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ data: rows, error: null }),
            }),
          }),
        };
      },
    };

    const counts = await presenceCountsForProject(admin2 as never, "proj-1");
    expect(counts.online).toBe(4);
    expect(counts.playing).toBe(2);
    expect(counts.by_game.hexii).toEqual({ online: 2, playing: 1 });
    expect(counts.by_game.tankii).toEqual({ online: 1, playing: 1 });
    expect(counts.by_game._).toEqual({ online: 1, playing: 0 });
    expect(counts.stale_after_sec).toBe(90);
    void admin;
  });
});
