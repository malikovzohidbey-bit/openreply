/**
 * snapshot-media-insights cron — Unit Tests
 *
 * The route is the only thing that ever writes a post's growth curve, so the
 * cases that matter are the ones that would quietly lose data: a post skipped
 * when it was due, one bad post taking the rest of the run down with it, or
 * the same account's follower count being fetched once per post.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockPrisma,
  mockDecryptToken,
  mockGetUserInfo,
  mockGetMediaFields,
  mockFetchGroups,
} = vi.hoisted(() => ({
  mockPrisma: {
    post: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    mediaInsightSnapshot: {
      create: vi.fn(),
    },
    operationalEvent: {
      create: vi.fn(),
    },
  },
  mockDecryptToken: vi.fn(),
  mockGetUserInfo: vi.fn(),
  mockGetMediaFields: vi.fn(),
  mockFetchGroups: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));
vi.mock("@/lib/meta/client", () => ({
  getUserInfo: mockGetUserInfo,
  getMediaFields: mockGetMediaFields,
}));
vi.mock("@/lib/insights/fetch-media-insights", () => ({
  fetchMediaInsightGroups: mockFetchGroups,
}));

const { GET } = await import("../app/api/cron/snapshot-media-insights/route");

const SECRET = "s".repeat(48);
const HOUR = 3_600_000;

const ACCOUNT = {
  id: "acc_1",
  workspaceId: "ws_1",
  username: "jilo",
  instagramId: "ig_1",
  accessToken: "enc",
};

function request(token: string = SECRET) {
  return new NextRequest("http://localhost/api/cron/snapshot-media-insights", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * A published reel. By default it went out 2h ago and was last captured 90
 * minutes ago — past the hourly interval, so it is due.
 */
function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post_1",
    mediaType: "REEL",
    status: "PUBLISHED",
    igMediaId: "media_1",
    publishedAt: new Date(Date.now() - 2 * HOUR),
    permalink: "https://instagram.com/reel/abc/",
    thumbnailUrl: null,
    instagramAccount: ACCOUNT,
    insightSnapshots: [{ capturedAt: new Date(Date.now() - 1.5 * HOUR) }],
    ...overrides,
  };
}

const METRICS = {
  views: 1200,
  reach: 900,
  likes: 80,
  comments: 6,
  saved: 14,
  shares: 9,
  total_interactions: 109,
  reposts: 3,
  ig_reels_avg_watch_time: 4321,
  ig_reels_video_view_total_time: 5_185_200_000,
  reels_skip_rate: 28.5,
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mockPrisma.post.findMany.mockReset();
  mockFetchGroups.mockReset();
  mockGetUserInfo.mockReset();
  mockGetMediaFields.mockReset();

  vi.stubEnv("CRON_SECRET", SECRET);
  mockDecryptToken.mockReturnValue("token");
  mockGetUserInfo.mockResolvedValue({ followers_count: 5000 });
  mockGetMediaFields.mockResolvedValue({});
  mockFetchGroups.mockResolvedValue({ metrics: METRICS, errors: {} });
  mockPrisma.post.update.mockResolvedValue({});
  mockPrisma.mediaInsightSnapshot.create.mockResolvedValue({});
  mockPrisma.operationalEvent.create.mockResolvedValue({});
});

describe("snapshot-media-insights — auth", () => {
  it("rejects a wrong bearer with 401 and touches nothing", async () => {
    const res = await GET(request("wrong"));

    expect(res.status).toBe(401);
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.mediaInsightSnapshot.create).not.toHaveBeenCalled();
  });

  it("rejects a request with no authorization header", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/cron/snapshot-media-insights")
    );

    expect(res.status).toBe(401);
  });

  it("falls back to NEXTAUTH_SECRET when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(48));
    mockPrisma.post.findMany.mockResolvedValue([]);

    const res = await GET(request("n".repeat(48)));

    expect(res.status).toBe(200);
  });
});

describe("snapshot-media-insights — selection", () => {
  it("queries only published posts with a media id inside the 180-day window", async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);

    await GET(request());

    const args = mockPrisma.post.findMany.mock.calls[0][0];
    expect(args.where.status).toBe("PUBLISHED");
    expect(args.where.igMediaId).toEqual({ not: null });
    expect(args.where.publishedAt.not).toBeNull();
    const ageDays =
      (Date.now() - args.where.publishedAt.gte.getTime()) / (24 * HOUR);
    expect(Math.round(ageDays)).toBe(180);
    expect(args.include.insightSnapshots).toEqual({
      orderBy: { capturedAt: "desc" },
      take: 1,
      select: { capturedAt: true },
    });
  });

  it("skips a post whose last capture is still inside its interval", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post({ insightSnapshots: [{ capturedAt: new Date(Date.now() - 20 * 60_000) }] }),
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(mockPrisma.mediaInsightSnapshot.create).not.toHaveBeenCalled();
    expect(mockFetchGroups).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      data: { candidates: 1, due: 0, snapshots: 0, failures: [] },
    });
  });

  it("captures a never-captured post", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post({ insightSnapshots: [] }),
    ]);

    await GET(request());

    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("caps a run at 100 posts, never-captured and longest-waiting first", async () => {
    const waiting = Array.from({ length: 100 }, (_, i) =>
      post({
        id: `old_${i}`,
        igMediaId: `media_old_${i}`,
        insightSnapshots: [
          { capturedAt: new Date(Date.now() - (3 + i / 100) * HOUR) },
        ],
      })
    );
    const fresh = post({
      id: "never",
      igMediaId: "media_never",
      insightSnapshots: [],
    });
    mockPrisma.post.findMany.mockResolvedValue([...waiting, fresh]);

    const res = await GET(request());
    const body = await res.json();

    expect(body.data.candidates).toBe(101);
    expect(body.data.due).toBe(101);
    expect(body.data.snapshots).toBe(100);
    const captured = mockPrisma.mediaInsightSnapshot.create.mock.calls.map(
      (c) => c[0].data.postId
    );
    expect(captured[0]).toBe("never");
    // old_0 was captured most recently (3h ago), so it waited least and is the
    // one left over for the next run.
    expect(captured).not.toContain("old_0");
  });
});

describe("snapshot-media-insights — snapshot content", () => {
  it("writes a due post's metrics under the mapped column names", async () => {
    mockPrisma.post.findMany.mockResolvedValue([post()]);

    const res = await GET(request());
    const body = await res.json();

    expect(mockFetchGroups).toHaveBeenCalledWith("token", "media_1", "REEL");
    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledWith({
      data: {
        postId: "post_1",
        igMediaId: "media_1",
        views: 1200,
        reach: 900,
        likes: 80,
        comments: 6,
        saved: 14,
        shares: 9,
        reposts: 3,
        totalInteractions: 109,
        avgWatchTimeMs: 4321,
        totalWatchTimeMs: 5_185_200_000,
        skipRatePct: 28.5,
        followersCount: 5000,
        errors: undefined,
        raw: METRICS,
      },
    });
    expect(body.data).toEqual({
      candidates: 1,
      due: 1,
      snapshots: 1,
      failures: [],
    });
  });

  it("stores group errors next to whatever metrics did come back", async () => {
    mockFetchGroups.mockResolvedValue({
      metrics: { views: 10 },
      errors: { reelsSkip: "not available" },
    });
    mockPrisma.post.findMany.mockResolvedValue([post()]);

    await GET(request());

    const data = mockPrisma.mediaInsightSnapshot.create.mock.calls[0][0].data;
    expect(data.views).toBe(10);
    expect(data.reach).toBeNull();
    expect(data.skipRatePct).toBeNull();
    expect(data.errors).toEqual({ reelsSkip: "not available" });
    expect(data.raw).toEqual({ views: 10 });
  });

  it("writes no snapshot when every metric group failed, so the post is retried next hour", async () => {
    mockFetchGroups.mockResolvedValue({
      metrics: {},
      errors: { core: "token expired", reelsWatch: "token expired" },
    });
    mockPrisma.post.findMany.mockResolvedValue([post()]);

    const res = await GET(request());
    const body = await res.json();

    expect(mockPrisma.mediaInsightSnapshot.create).not.toHaveBeenCalled();
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledTimes(1);
    expect(body.data.snapshots).toBe(0);
    expect(body.data.failures[0].reason).toContain("token expired");
  });

  it("still snapshots when the follower count is unavailable", async () => {
    mockGetUserInfo.mockRejectedValue(new Error("rate limited"));
    mockPrisma.post.findMany.mockResolvedValue([post()]);

    await GET(request());

    const data = mockPrisma.mediaInsightSnapshot.create.mock.calls[0][0].data;
    expect(data.followersCount).toBeNull();
    expect(data.views).toBe(1200);
  });
});

describe("snapshot-media-insights — account follower count", () => {
  it("fetches followers once for two posts of the same account", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post({ id: "post_a", igMediaId: "media_a" }),
      post({ id: "post_b", igMediaId: "media_b" }),
    ]);

    await GET(request());

    expect(mockGetUserInfo).toHaveBeenCalledTimes(1);
    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(2);
  });

  it("fetches followers once per account", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post({ id: "post_a", igMediaId: "media_a" }),
      post({
        id: "post_b",
        igMediaId: "media_b",
        instagramAccount: { ...ACCOUNT, id: "acc_2", username: "other" },
      }),
    ]);

    await GET(request());

    expect(mockGetUserInfo).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed follower lookup for the account's other posts", async () => {
    mockGetUserInfo.mockRejectedValue(new Error("boom"));
    mockPrisma.post.findMany.mockResolvedValue([
      post({ id: "post_a", igMediaId: "media_a" }),
      post({ id: "post_b", igMediaId: "media_b" }),
    ]);

    await GET(request());

    expect(mockGetUserInfo).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot-media-insights — permalink", () => {
  it("fetches and saves the permalink only when the post has none", async () => {
    mockGetMediaFields.mockResolvedValue({
      permalink: "https://instagram.com/reel/xyz/",
      thumbnail_url: "https://cdn.test/t.jpg",
    });
    mockPrisma.post.findMany.mockResolvedValue([post({ permalink: null })]);

    await GET(request());

    expect(mockGetMediaFields).toHaveBeenCalledWith("token", "media_1", [
      "permalink",
      "thumbnail_url",
    ]);
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "post_1" },
      data: {
        permalink: "https://instagram.com/reel/xyz/",
        thumbnailUrl: "https://cdn.test/t.jpg",
      },
    });
  });

  it("leaves a post that already has a permalink alone", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post({ permalink: "https://instagram.com/reel/abc/" }),
    ]);

    await GET(request());

    expect(mockGetMediaFields).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).not.toHaveBeenCalled();
  });

  it("does not write an empty update when Instagram returns neither field", async () => {
    mockGetMediaFields.mockResolvedValue({ id: "media_1" });
    mockPrisma.post.findMany.mockResolvedValue([post({ permalink: null })]);

    await GET(request());

    expect(mockPrisma.post.update).not.toHaveBeenCalled();
    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("still snapshots when the permalink lookup fails", async () => {
    mockGetMediaFields.mockRejectedValue(new Error("boom"));
    mockPrisma.post.findMany.mockResolvedValue([post({ permalink: null })]);

    const res = await GET(request());
    const body = await res.json();

    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
    expect(body.data.failures).toEqual([]);
    expect(mockPrisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("still snapshots when saving the permalink fails", async () => {
    mockGetMediaFields.mockResolvedValue({ permalink: "https://x.test/p/" });
    mockPrisma.post.update.mockRejectedValue(new Error("db down"));
    mockPrisma.post.findMany.mockResolvedValue([post({ permalink: null })]);

    await GET(request());

    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot-media-insights — failures", () => {
  it("logs a failing post and still snapshots the others", async () => {
    mockFetchGroups.mockImplementation(
      async (_token: string, mediaId: string) => {
        if (mediaId === "media_bad") throw new Error("Insights unavailable");
        return { metrics: METRICS, errors: {} };
      }
    );
    mockPrisma.post.findMany.mockResolvedValue([
      post({ id: "post_bad", igMediaId: "media_bad" }),
      post({ id: "post_ok", igMediaId: "media_ok" }),
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledWith({
      data: {
        source: "SYSTEM",
        level: "WARNING",
        workspaceId: "ws_1",
        message: "Media insight snapshot failed",
        payload: {
          postId: "post_bad",
          igMediaId: "media_bad",
          reason: "Insights unavailable",
        },
      },
    });
    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.mediaInsightSnapshot.create.mock.calls[0][0].data.postId).toBe(
      "post_ok"
    );
    expect(body.data.snapshots).toBe(1);
    expect(body.data.failures).toEqual([
      { postId: "post_bad", reason: "Insights unavailable" },
    ]);
  });

  it("treats a token that cannot be decrypted as a per-post failure", async () => {
    mockDecryptToken.mockImplementationOnce(() => {
      throw new Error("bad key");
    });
    mockPrisma.post.findMany.mockResolvedValue([
      post({ id: "post_a", igMediaId: "media_a" }),
      post({ id: "post_b", igMediaId: "media_b" }),
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(body.data.failures).toEqual([
      { postId: "post_a", reason: "bad key" },
    ]);
    expect(mockPrisma.mediaInsightSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("survives the failure log itself failing", async () => {
    mockFetchGroups.mockRejectedValue(new Error("boom"));
    mockPrisma.operationalEvent.create.mockRejectedValue(new Error("db down"));
    mockPrisma.post.findMany.mockResolvedValue([post()]);

    const res = await GET(request());

    expect(res.status).toBe(200);
  });
});
