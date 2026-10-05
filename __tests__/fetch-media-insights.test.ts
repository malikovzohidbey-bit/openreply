/**
 * fetchMediaInsightGroups — Unit Tests
 *
 * Instagram rejects a whole insights request when one metric in it is invalid
 * for the media, and reels_skip_rate is still "in development". The groups are
 * therefore separate calls, and one failing must never cost the others.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetMediaInsights } = vi.hoisted(() => ({
  mockGetMediaInsights: vi.fn(),
}));

vi.mock("@/lib/meta/client", () => ({
  getMediaInsights: mockGetMediaInsights,
}));

const { fetchMediaInsightGroups } = await import(
  "../lib/insights/fetch-media-insights"
);

const CORE = [
  "views",
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
];
const WATCH = ["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
const SKIP = ["reels_skip_rate"];
const REPOSTS = ["reposts"];

/** Answers each call with a value per requested metric, keyed by the list. */
function respondByMetric(
  byFirstMetric: Record<string, Record<string, number> | Error>
) {
  mockGetMediaInsights.mockImplementation(
    async (_token: string, _mediaId: string, metrics: string[]) => {
      const answer = byFirstMetric[metrics[0]];
      if (answer instanceof Error) throw answer;
      return answer ?? {};
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMediaInsights.mockReset();
});

describe("fetchMediaInsightGroups — reels", () => {
  it("makes one call per group with the exact metric lists", async () => {
    respondByMetric({});

    await fetchMediaInsightGroups("token", "media_1", "REEL");

    expect(mockGetMediaInsights).toHaveBeenCalledTimes(4);
    expect(mockGetMediaInsights).toHaveBeenNthCalledWith(
      1,
      "token",
      "media_1",
      CORE
    );
    expect(mockGetMediaInsights).toHaveBeenNthCalledWith(
      2,
      "token",
      "media_1",
      WATCH
    );
    expect(mockGetMediaInsights).toHaveBeenNthCalledWith(
      3,
      "token",
      "media_1",
      SKIP
    );
    expect(mockGetMediaInsights).toHaveBeenNthCalledWith(
      4,
      "token",
      "media_1",
      REPOSTS
    );
  });

  it("merges every group into one metrics object", async () => {
    respondByMetric({
      views: { views: 1000, reach: 800, likes: 50 },
      ig_reels_avg_watch_time: {
        ig_reels_avg_watch_time: 4200,
        ig_reels_video_view_total_time: 4_200_000,
      },
      reels_skip_rate: { reels_skip_rate: 31.5 },
      reposts: { reposts: 7 },
    });

    const result = await fetchMediaInsightGroups("token", "media_1", "REEL");

    expect(result.errors).toEqual({});
    expect(result.metrics).toEqual({
      views: 1000,
      reach: 800,
      likes: 50,
      ig_reels_avg_watch_time: 4200,
      ig_reels_video_view_total_time: 4_200_000,
      reels_skip_rate: 31.5,
      reposts: 7,
    });
  });

  it("keeps the other groups when one throws and records why", async () => {
    respondByMetric({
      views: { views: 1000, reach: 800 },
      ig_reels_avg_watch_time: { ig_reels_avg_watch_time: 4200 },
      reels_skip_rate: new Error("metric reels_skip_rate is not available"),
      reposts: { reposts: 7 },
    });

    const result = await fetchMediaInsightGroups("token", "media_1", "REEL");

    expect(result.metrics).toEqual({
      views: 1000,
      reach: 800,
      ig_reels_avg_watch_time: 4200,
      reposts: 7,
    });
    expect(result.errors).toEqual({
      reelsSkip: "metric reels_skip_rate is not available",
    });
  });

  it("returns empty metrics and four errors, without throwing, when all fail", async () => {
    mockGetMediaInsights.mockRejectedValue(new Error("boom"));

    const result = await fetchMediaInsightGroups("token", "media_1", "REEL");

    expect(result.metrics).toEqual({});
    expect(result.errors).toEqual({
      core: "boom",
      reelsWatch: "boom",
      reelsSkip: "boom",
      reposts: "boom",
    });
  });

  it("stringifies a non-Error rejection", async () => {
    mockGetMediaInsights.mockRejectedValue("nope");

    const result = await fetchMediaInsightGroups("token", "media_1", "REEL");

    expect(result.errors.core).toBe("nope");
  });
});

describe("fetchMediaInsightGroups — images and videos", () => {
  it("makes a single core call for an IMAGE", async () => {
    respondByMetric({ views: { views: 10, reach: 9 } });

    const result = await fetchMediaInsightGroups("token", "media_2", "IMAGE");

    expect(mockGetMediaInsights).toHaveBeenCalledTimes(1);
    expect(mockGetMediaInsights).toHaveBeenCalledWith(
      "token",
      "media_2",
      CORE
    );
    expect(result.metrics).toEqual({ views: 10, reach: 9 });
    expect(result.errors).toEqual({});
  });

  it("makes a single core call for a VIDEO", async () => {
    respondByMetric({});

    await fetchMediaInsightGroups("token", "media_3", "VIDEO");

    expect(mockGetMediaInsights).toHaveBeenCalledTimes(1);
    expect(mockGetMediaInsights).toHaveBeenCalledWith(
      "token",
      "media_3",
      CORE
    );
  });

  it("records a core failure for an IMAGE without throwing", async () => {
    mockGetMediaInsights.mockRejectedValue(new Error("views not supported"));

    const result = await fetchMediaInsightGroups("token", "media_2", "IMAGE");

    expect(result.metrics).toEqual({});
    expect(result.errors).toEqual({ core: "views not supported" });
  });
});
