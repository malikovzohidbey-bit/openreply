/**
 * Jilo metrics — Unit Tests
 *
 * The page's verdicts and the nightly analyzer's to-do list are both decided
 * here, so every rule is pinned at its exact boundary.
 */

import { describe, it, expect } from "vitest";
import {
  deriveMetrics,
  median,
  needsAnalysis,
  round3,
  valueAtAge,
  verdictFor,
  type SnapshotNumbers,
} from "../lib/jilo/metrics";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PUBLISHED = new Date("2026-10-01T00:00:00Z");

function snap(overrides: Partial<SnapshotNumbers> = {}): SnapshotNumbers {
  return {
    capturedAt: PUBLISHED,
    views: null,
    reach: null,
    likes: null,
    comments: null,
    saved: null,
    shares: null,
    reposts: null,
    totalInteractions: null,
    avgWatchTimeMs: null,
    totalWatchTimeMs: null,
    skipRatePct: null,
    followersCount: null,
    ...overrides,
  };
}

/** A snapshot `hours` after PUBLISHED with the given views. */
function at(hours: number, views: number | null, extra: Partial<SnapshotNumbers> = {}) {
  return snap({
    capturedAt: new Date(PUBLISHED.getTime() + hours * HOUR),
    views,
    ...extra,
  });
}

describe("round3", () => {
  it("rounds to 3 decimals and nulls non-finite input", () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(null)).toBeNull();
    expect(round3(Number.NaN)).toBeNull();
    expect(round3(Infinity)).toBeNull();
  });
});

describe("deriveMetrics", () => {
  const full = snap({
    views: 1000,
    reach: 800,
    saved: 20,
    shares: 10,
    comments: 5,
    totalInteractions: 100,
    avgWatchTimeMs: 6000,
    totalWatchTimeMs: 18_000_000,
  });

  it("computes every ratio, rounded to 3 decimals", () => {
    expect(deriveMetrics({ durationSec: 15, snap: full })).toEqual({
      retentionPct: 40, // 6 s of 15 s
      replayRatio: 1.2, // 18,000 s watched / (1000 views × 15 s)
      viewsPerReach: 1.25,
      saveRate: 0.02,
      shareRate: 0.01,
      commentRate: 0.005,
      engagementRate: 0.125,
    });
  });

  it("rounds a repeating fraction", () => {
    const m = deriveMetrics({
      durationSec: 30,
      snap: snap({ views: 3, reach: 3, saved: 1, avgWatchTimeMs: 10_000 }),
    });
    expect(m.saveRate).toBe(0.333);
    expect(m.retentionPct).toBe(33.333);
  });

  it("leaves duration-based metrics null when the duration is missing", () => {
    const m = deriveMetrics({ durationSec: null, snap: full });
    expect(m.retentionPct).toBeNull();
    expect(m.replayRatio).toBeNull();
    expect(m.saveRate).toBe(0.02);
  });

  it("treats a zero or negative duration as missing", () => {
    expect(deriveMetrics({ durationSec: 0, snap: full }).retentionPct).toBeNull();
    expect(deriveMetrics({ durationSec: -5, snap: full }).replayRatio).toBeNull();
  });

  it("never divides by zero or by a missing denominator", () => {
    const m = deriveMetrics({
      durationSec: 15,
      snap: snap({ views: 0, reach: 0, saved: 3, totalWatchTimeMs: 100 }),
    });
    expect(m).toEqual({
      retentionPct: null,
      replayRatio: null,
      viewsPerReach: null,
      saveRate: null,
      shareRate: null,
      commentRate: null,
      engagementRate: null,
    });
  });

  it("returns all nulls without a snapshot", () => {
    const m = deriveMetrics({ durationSec: 15, snap: null });
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});

describe("valueAtAge", () => {
  it("uses a snapshot captured exactly at the target age", () => {
    expect(valueAtAge([at(23, 900), at(24, 1000), at(25, 1100)], PUBLISHED, 24, "views")).toBe(1000);
  });

  it("uses a snapshot 45 min off the target (window edge, inclusive)", () => {
    expect(valueAtAge([at(24.75, 1234)], PUBLISHED, 24, "views")).toBe(1234);
    expect(valueAtAge([at(23.25, 777)], PUBLISHED, 24, "views")).toBe(777);
  });

  it("picks the closest snapshot when several are inside the window", () => {
    expect(valueAtAge([at(23.5, 500), at(24.1, 600)], PUBLISHED, 24, "views")).toBe(600);
  });

  it("interpolates linearly outside the window — midpoint", () => {
    // 22h → 1000, 26h → 2000; 24h is halfway.
    expect(valueAtAge([at(22, 1000), at(26, 2000)], PUBLISHED, 24, "views")).toBe(1500);
  });

  it("interpolates off-center and rounds to 3 decimals", () => {
    // 20h → 0, 27h → 700: 24h is 4/7 of the way.
    expect(valueAtAge([at(20, 0), at(27, 700)], PUBLISHED, 24, "views")).toBe(400);
    expect(valueAtAge([at(20, 0), at(30, 1)], PUBLISHED, 23, "views")).toBe(0.3);
  });

  it("a snapshot 46 min off is not 'at' the age — needs the other side", () => {
    const justOutside = at(24 + 46 / 60, 1000);
    expect(valueAtAge([justOutside], PUBLISHED, 24, "views")).toBeNull();
  });

  it("returns null when the post has not reached the age yet (no extrapolation)", () => {
    expect(valueAtAge([at(1, 100), at(10, 500)], PUBLISHED, 24, "views")).toBeNull();
  });

  it("returns null when every snapshot is after the target", () => {
    expect(valueAtAge([at(30, 3000), at(40, 4000)], PUBLISHED, 24, "views")).toBeNull();
  });

  it("skips snapshots whose field is null", () => {
    expect(valueAtAge([at(22, 1000), at(24, null), at(26, 2000)], PUBLISHED, 24, "views")).toBe(1500);
  });

  it("works for any numeric field and ISO-string dates", () => {
    const s = [
      { ...at(22, 1), reach: 100, capturedAt: new Date(PUBLISHED.getTime() + 22 * HOUR).toISOString() },
      { ...at(26, 1), reach: 300, capturedAt: new Date(PUBLISHED.getTime() + 26 * HOUR).toISOString() },
    ];
    expect(valueAtAge(s, PUBLISHED.toISOString(), 24, "reach")).toBe(200);
  });

  it("returns null without a publish time or snapshots", () => {
    expect(valueAtAge([at(24, 1)], null, 24, "views")).toBeNull();
    expect(valueAtAge([], PUBLISHED, 24, "views")).toBeNull();
  });
});

describe("median", () => {
  it("odd and even counts, ignoring non-numbers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, null, undefined, Number.NaN])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe("verdictFor", () => {
  const peers = [100, 100, 100]; // median 100

  it("UCHDI at exactly 2× the median", () => {
    expect(verdictFor({ value: 200, peerValues: peers })).toBe("UCHDI");
  });

  it("O'RTACHA just under 2× and just over 0.5×", () => {
    expect(verdictFor({ value: 199.9, peerValues: peers })).toBe("O'RTACHA");
    expect(verdictFor({ value: 50.1, peerValues: peers })).toBe("O'RTACHA");
  });

  it("UCHMADI at exactly 0.5× the median", () => {
    expect(verdictFor({ value: 50, peerValues: peers })).toBe("UCHMADI");
  });

  it("KUTILMOQDA with only 2 peers", () => {
    expect(verdictFor({ value: 1000, peerValues: [100, 100] })).toBe("KUTILMOQDA");
  });

  it("peers without a value do not count toward minPeers", () => {
    expect(verdictFor({ value: 1000, peerValues: [100, 100, null] })).toBe("KUTILMOQDA");
  });

  it("KUTILMOQDA when the value itself is unknown", () => {
    expect(verdictFor({ value: null, peerValues: peers })).toBe("KUTILMOQDA");
  });

  it("honors a custom minPeers", () => {
    expect(verdictFor({ value: 300, peerValues: [100], minPeers: 1 })).toBe("UCHDI");
  });

  it("uses the median, not the mean (one viral peer does not move it)", () => {
    expect(verdictFor({ value: 200, peerValues: [100, 100, 100000] })).toBe("UCHDI");
  });

  it("a zero median: any views is UCHDI, zero is O'RTACHA", () => {
    expect(verdictFor({ value: 5, peerValues: [0, 0, 0] })).toBe("UCHDI");
    expect(verdictFor({ value: 0, peerValues: [0, 0, 0] })).toBe("O'RTACHA");
  });
});

describe("needsAnalysis", () => {
  const now = new Date(PUBLISHED.getTime() + 10 * DAY);
  const latest = { id: "s_latest", views: 1300 };
  const base = {
    status: "PUBLISHED",
    publishedAt: PUBLISHED,
    latestSnapshot: latest,
    analysis: null,
    now,
  };

  it("true for a published, snapshotted post ≥ 24h old with no analysis", () => {
    expect(needsAnalysis(base)).toBe(true);
  });

  it("true at exactly 24h, false a second before", () => {
    const at24 = new Date(PUBLISHED.getTime() + DAY);
    expect(needsAnalysis({ ...base, now: at24 })).toBe(true);
    expect(needsAnalysis({ ...base, now: new Date(at24.getTime() - 1000) })).toBe(false);
  });

  it("false when not published, never published, or without a snapshot", () => {
    expect(needsAnalysis({ ...base, status: "SCHEDULED" })).toBe(false);
    expect(needsAnalysis({ ...base, status: "FAILED" })).toBe(false);
    expect(needsAnalysis({ ...base, publishedAt: null })).toBe(false);
    expect(needsAnalysis({ ...base, latestSnapshot: null })).toBe(false);
  });

  it("false while the analysis is 7 days old or newer, even if views moved", () => {
    const analysis = {
      generatedAt: new Date(now.getTime() - 7 * DAY),
      basedOnSnapshotId: "s_old",
    };
    const snapshots = [{ id: "s_old", views: 100 }, latest];
    expect(needsAnalysis({ ...base, analysis, snapshots })).toBe(false);
  });

  describe("with an analysis older than 7 days", () => {
    const generatedAt = new Date(now.getTime() - 8 * DAY);

    it("true when views moved more than 20%", () => {
      const snapshots = [{ id: "s_old", views: 1000 }, latest]; // +30%
      expect(
        needsAnalysis({ ...base, analysis: { generatedAt, basedOnSnapshotId: "s_old" }, snapshots })
      ).toBe(true);
    });

    it("false at exactly +20% (must be more than 20%)", () => {
      const snapshots = [{ id: "s_old", views: 1000 }, { id: "s_latest", views: 1200 }];
      expect(
        needsAnalysis({
          ...base,
          latestSnapshot: { id: "s_latest", views: 1200 },
          analysis: { generatedAt, basedOnSnapshotId: "s_old" },
          snapshots,
        })
      ).toBe(false);
    });

    it("true when the based-on snapshot is not found", () => {
      expect(
        needsAnalysis({
          ...base,
          analysis: { generatedAt, basedOnSnapshotId: "s_gone" },
          snapshots: [latest],
        })
      ).toBe(true);
    });

    it("true when the analysis has no based-on snapshot at all", () => {
      expect(
        needsAnalysis({ ...base, analysis: { generatedAt, basedOnSnapshotId: null } })
      ).toBe(true);
    });

    it("from a 0-view base: changed once there is any view", () => {
      const analysis = { generatedAt, basedOnSnapshotId: "s_zero" };
      expect(
        needsAnalysis({ ...base, analysis, snapshots: [{ id: "s_zero", views: 0 }] })
      ).toBe(true);
      expect(
        needsAnalysis({
          ...base,
          latestSnapshot: { views: 0 },
          analysis,
          snapshots: [{ id: "s_zero", views: 0 }],
        })
      ).toBe(false);
    });
  });
});
