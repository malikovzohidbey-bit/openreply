/**
 * Insight snapshot cadence — Unit Tests
 *
 * The cadence decides how many growth-curve points a post gets. An off-by-one
 * at a boundary or a missing tolerance silently thins the curve, and nothing
 * downstream can tell the point was never captured.
 */

import { describe, it, expect } from "vitest";
import {
  isSnapshotDue,
  snapshotIntervalMs,
  METRIC_GROUPS,
} from "../lib/insights/cadence";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("snapshotIntervalMs", () => {
  it("is hourly for the first 48 hours", () => {
    expect(snapshotIntervalMs(0)).toBe(HOUR);
    expect(snapshotIntervalMs(47 * HOUR)).toBe(HOUR);
  });

  it("switches to 6h exactly at 48 hours", () => {
    expect(snapshotIntervalMs(48 * HOUR)).toBe(6 * HOUR);
    expect(snapshotIntervalMs(6 * DAY)).toBe(6 * HOUR);
  });

  it("switches to daily exactly at 7 days", () => {
    expect(snapshotIntervalMs(7 * DAY)).toBe(DAY);
    expect(snapshotIntervalMs(29 * DAY)).toBe(DAY);
  });

  it("switches to weekly exactly at 30 days", () => {
    expect(snapshotIntervalMs(30 * DAY)).toBe(7 * DAY);
    expect(snapshotIntervalMs(120 * DAY)).toBe(7 * DAY);
  });
});

describe("isSnapshotDue", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const publishedAgo = (ms: number) => new Date(now.getTime() - ms);

  it("is due when the post has never been captured", () => {
    expect(isSnapshotDue(publishedAgo(HOUR), null, now)).toBe(true);
    expect(isSnapshotDue(publishedAgo(100 * DAY), null, now)).toBe(true);
  });

  it("is not due 30 minutes after a capture of a 1h-old post", () => {
    const last = new Date(now.getTime() - 30 * MIN);
    expect(isSnapshotDue(publishedAgo(HOUR), last, now)).toBe(false);
  });

  it("is due at 59 minutes: the 2-minute tolerance absorbs cron jitter", () => {
    const last = new Date(now.getTime() - 59 * MIN);
    expect(isSnapshotDue(publishedAgo(HOUR), last, now)).toBe(true);
  });

  it("is not due just inside the tolerance edge", () => {
    const last = new Date(now.getTime() - 57 * MIN);
    expect(isSnapshotDue(publishedAgo(HOUR), last, now)).toBe(false);
  });

  it("is not due 5h after a capture of a 3-day-old post", () => {
    const last = new Date(now.getTime() - 5 * HOUR);
    expect(isSnapshotDue(publishedAgo(3 * DAY), last, now)).toBe(false);
  });

  it("is due 6h after a capture of a 3-day-old post", () => {
    const last = new Date(now.getTime() - 6 * HOUR);
    expect(isSnapshotDue(publishedAgo(3 * DAY), last, now)).toBe(true);
  });

  it("waits a full week once the post is older than 30 days", () => {
    const sixDays = new Date(now.getTime() - 6 * DAY);
    const sevenDays = new Date(now.getTime() - 7 * DAY);
    expect(isSnapshotDue(publishedAgo(60 * DAY), sixDays, now)).toBe(false);
    expect(isSnapshotDue(publishedAgo(60 * DAY), sevenDays, now)).toBe(true);
  });
});

describe("METRIC_GROUPS", () => {
  it("keeps the unstable skip-rate metric in a group of its own", () => {
    const skip = METRIC_GROUPS.find((g) => g.name === "reelsSkip");
    expect(skip?.metrics).toEqual(["reels_skip_rate"]);
    expect(skip?.reelOnly).toBe(true);
  });

  it("marks only the core group as valid for every media type", () => {
    expect(
      METRIC_GROUPS.filter((g) => !g.reelOnly).map((g) => g.name)
    ).toEqual(["core"]);
  });
});
