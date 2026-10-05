/**
 * When to capture insights for a published post, and which metric groups to
 * ask Instagram for.
 *
 * Instagram returns lifetime totals only, never a time series. A post's growth
 * curve therefore exists only if we sample it ourselves, and it is steepest in
 * the first hours — so the sampling gets sparser as the post ages: hourly for
 * the first 48h, every 6h up to a week, daily up to a month, weekly after.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The cron fires on the hour, a little late or early. Without slack, a post
// captured at 10:10:04 would not be "due" at 11:10:01 and would silently slip
// to the 12:10 run — doubling the gap for no reason.
const DUE_TOLERANCE_MS = 2 * MINUTE_MS;

/** How long to wait between two captures for a post of this age. */
export function snapshotIntervalMs(ageMs: number): number {
  if (ageMs < 48 * HOUR_MS) return HOUR_MS;
  if (ageMs < 7 * DAY_MS) return 6 * HOUR_MS;
  if (ageMs < 30 * DAY_MS) return DAY_MS;
  return 7 * DAY_MS;
}

/** True when the post has never been captured or its interval has elapsed. */
export function isSnapshotDue(
  publishedAt: Date,
  lastCapturedAt: Date | null,
  now: Date
): boolean {
  if (!lastCapturedAt) return true;

  const ageMs = now.getTime() - publishedAt.getTime();
  const sinceLastMs = now.getTime() - lastCapturedAt.getTime();
  return sinceLastMs >= snapshotIntervalMs(ageMs) - DUE_TOLERANCE_MS;
}

/**
 * Metric groups, each fetched in its own Graph API call. Instagram rejects the
 * whole request when a single metric in it is invalid for the media, so one
 * flaky metric (reels_skip_rate is still "in development") must not be able to
 * take the stable ones down with it.
 */
export const METRIC_GROUPS: ReadonlyArray<{
  name: "core" | "reelsWatch" | "reelsSkip" | "reposts";
  metrics: readonly string[];
  reelOnly: boolean;
}> = [
  {
    name: "core",
    metrics: [
      "views",
      "reach",
      "likes",
      "comments",
      "saved",
      "shares",
      "total_interactions",
    ],
    reelOnly: false,
  },
  {
    name: "reelsWatch",
    metrics: ["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"],
    reelOnly: true,
  },
  { name: "reelsSkip", metrics: ["reels_skip_rate"], reelOnly: true },
  { name: "reposts", metrics: ["reposts"], reelOnly: true },
];
