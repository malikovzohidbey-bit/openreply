/**
 * Jilo reels analytics — pure math over MediaInsightSnapshot rows.
 *
 * Nothing here touches the database or the clock: callers pass `now` and the
 * rows they already loaded, so every rule below is unit-testable at its exact
 * boundary (see __tests__/jilo-metrics.test.ts).
 *
 * Instagram only reports lifetime totals per capture. There is no
 * second-by-second retention curve in the API, so "retention" here is the
 * average watch time as a share of the video's length, and the 3-second skip
 * rate stands in for hook strength.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A snapshot within this distance of the target instant is used as-is. */
export const AGE_MATCH_WINDOW_MS = 45 * 60_000;

/** A post younger than this is not judged or analyzed yet. */
export const MIN_AGE_FOR_VERDICT_MS = 24 * HOUR_MS;

/** An analysis older than this may be rewritten if the numbers moved. */
export const ANALYSIS_STALE_MS = 7 * DAY_MS;

/** Relative views change (vs the analyzed snapshot) that justifies a rewrite. */
export const ANALYSIS_VIEWS_CHANGE = 0.2;

/** The numeric part of a MediaInsightSnapshot row. */
export interface SnapshotNumbers {
  capturedAt: Date | string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reposts: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  skipRatePct: number | null;
  followersCount: number | null;
}

export type SnapshotField = Exclude<keyof SnapshotNumbers, "capturedAt">;

export interface DerivedMetrics {
  /** Average watch time as % of the video length (can exceed 100 on loops). */
  retentionPct: number | null;
  /** Total watch time / (views × length): >1 means people rewatch. */
  replayRatio: number | null;
  viewsPerReach: number | null;
  saveRate: number | null;
  shareRate: number | null;
  commentRate: number | null;
  /** Total interactions / reach. */
  engagementRate: number | null;
}

/** Verdict computed from numbers. The apostrophe form is the display label. */
export type ComputedVerdict = "UCHDI" | "O'RTACHA" | "UCHMADI" | "KUTILMOQDA";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toMs(d: Date | string): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

/** Rounds to 3 decimals; null/NaN/Infinity become null. */
export function round3(v: number | null | undefined): number | null {
  if (!isNum(v)) return null;
  return Math.round(v * 1000) / 1000;
}

function ratio(num: number | null | undefined, den: number | null | undefined) {
  if (!isNum(num) || !isNum(den) || den <= 0) return null;
  return round3(num / den);
}

export function deriveMetrics({
  durationSec,
  snap,
}: {
  durationSec: number | null;
  snap: SnapshotNumbers | null;
}): DerivedMetrics {
  const duration = isNum(durationSec) && durationSec > 0 ? durationSec : null;

  if (!snap) {
    return {
      retentionPct: null,
      replayRatio: null,
      viewsPerReach: null,
      saveRate: null,
      shareRate: null,
      commentRate: null,
      engagementRate: null,
    };
  }

  const retentionPct =
    duration !== null && isNum(snap.avgWatchTimeMs)
      ? round3((snap.avgWatchTimeMs / 1000 / duration) * 100)
      : null;

  const replayRatio =
    duration !== null && isNum(snap.views) && snap.views > 0
      ? ratio(snap.totalWatchTimeMs, snap.views * duration * 1000)
      : null;

  return {
    retentionPct,
    replayRatio,
    viewsPerReach: ratio(snap.views, snap.reach),
    saveRate: ratio(snap.saved, snap.views),
    shareRate: ratio(snap.shares, snap.views),
    commentRate: ratio(snap.comments, snap.views),
    engagementRate: ratio(snap.totalInteractions, snap.reach),
  };
}

/**
 * Value of `field` when the post was exactly `ageHours` old.
 *
 * Rule (only snapshots where `field` is a number count):
 *  1. A snapshot captured within ±45 min of publishedAt + ageHours → its value
 *     (the closest one if several qualify).
 *  2. Otherwise, snapshots exist on both sides of that instant → linear
 *     interpolation between the nearest one before and the nearest one after.
 *  3. Otherwise → null. No extrapolation: if every snapshot is older than the
 *     target (the post has not reached that age yet, or tracking stopped) or
 *     every snapshot is newer (no capture before the target), the value is
 *     unknown rather than guessed.
 */
export function valueAtAge(
  snapshots: ReadonlyArray<SnapshotNumbers>,
  publishedAt: Date | string | null,
  ageHours: number,
  field: SnapshotField
): number | null {
  if (publishedAt === null) return null;
  const target = toMs(publishedAt) + ageHours * HOUR_MS;
  if (!Number.isFinite(target)) return null;

  let closest: { dist: number; value: number } | null = null;
  let before: { t: number; value: number } | null = null;
  let after: { t: number; value: number } | null = null;

  for (const s of snapshots) {
    const value = s[field];
    if (!isNum(value)) continue;
    const t = toMs(s.capturedAt);
    if (!Number.isFinite(t)) continue;

    const dist = Math.abs(t - target);
    if (dist <= AGE_MATCH_WINDOW_MS && (!closest || dist < closest.dist)) {
      closest = { dist, value };
    }
    if (t < target && (!before || t > before.t)) before = { t, value };
    if (t > target && (!after || t < after.t)) after = { t, value };
  }

  if (closest) return closest.value;
  if (before && after) {
    const frac = (target - before.t) / (after.t - before.t);
    return round3(before.value + (after.value - before.value) * frac);
  }
  return null;
}

/** Median of the finite numbers in `values`; null when there are none. */
export function median(values: ReadonlyArray<number | null | undefined>): number | null {
  const nums = values.filter(isNum).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * UCHDI (took off) when value ≥ 2 × peer median, UCHMADI (flopped) when
 * value ≤ 0.5 × median, O'RTACHA in between. KUTILMOQDA (waiting) when the
 * value is unknown or fewer than `minPeers` peers have a value — a median of
 * two posts says nothing. A zero median (every peer had no views) cannot be
 * scaled, so any positive value counts as UCHDI and zero as O'RTACHA.
 */
export function verdictFor({
  value,
  peerValues,
  minPeers = 3,
}: {
  value: number | null;
  peerValues: ReadonlyArray<number | null | undefined>;
  minPeers?: number;
}): ComputedVerdict {
  if (!isNum(value)) return "KUTILMOQDA";
  const peers = peerValues.filter(isNum);
  if (peers.length < minPeers) return "KUTILMOQDA";

  const m = median(peers) as number;
  if (m <= 0) return value > 0 ? "UCHDI" : "O'RTACHA";
  if (value >= 2 * m) return "UCHDI";
  if (value <= 0.5 * m) return "UCHMADI";
  return "O'RTACHA";
}

export interface AnalysisRef {
  generatedAt: Date | string;
  basedOnSnapshotId: string | null;
}

/**
 * Should the external analyzer (re)write this post's "why did it work" text?
 *
 * True for a PUBLISHED post that has at least one snapshot and is ≥ 24h old,
 * when either:
 *  - it has no analysis yet, or
 *  - the analysis is more than 7 days old AND views moved more than 20% since
 *    the snapshot it was based on. A missing/unknown base snapshot (or one
 *    without a views number) counts as "moved"; a base of 0 views counts as
 *    moved once there is any view. No current views number → not moved.
 */
export function needsAnalysis({
  status,
  publishedAt,
  latestSnapshot,
  analysis,
  snapshots = [],
  now,
}: {
  status: string;
  publishedAt: Date | string | null;
  latestSnapshot: (Pick<SnapshotNumbers, "views"> & { id?: string }) | null;
  analysis: AnalysisRef | null;
  /** Rows to look the analysis' basedOnSnapshotId up in. */
  snapshots?: ReadonlyArray<{ id: string; views: number | null }>;
  now: Date;
}): boolean {
  if (status !== "PUBLISHED" || publishedAt === null || !latestSnapshot) {
    return false;
  }
  const ageMs = now.getTime() - toMs(publishedAt);
  if (!(ageMs >= MIN_AGE_FOR_VERDICT_MS)) return false;

  if (!analysis) return true;

  const analysisAgeMs = now.getTime() - toMs(analysis.generatedAt);
  if (!(analysisAgeMs > ANALYSIS_STALE_MS)) return false;

  const current = latestSnapshot.views;
  if (!isNum(current)) return false;

  const base = analysis.basedOnSnapshotId
    ? snapshots.find((s) => s.id === analysis.basedOnSnapshotId)
    : undefined;
  if (!base || !isNum(base.views)) return true;
  if (base.views === 0) return current > 0;

  return Math.abs(current - base.views) / base.views > ANALYSIS_VIEWS_CHANGE;
}
