/**
 * Turns Jilo posts (with their snapshots and analysis, as loaded by Prisma)
 * into the JSON rows the /api/jilo/videos routes return. Pure: the routes do
 * the querying, this file does the shaping, so it is tested through them
 * without a database.
 */

import {
  deriveMetrics,
  median,
  MIN_AGE_FOR_VERDICT_MS,
  needsAnalysis,
  round3,
  valueAtAge,
  verdictFor,
  type ComputedVerdict,
  type DerivedMetrics,
  type SnapshotNumbers,
} from "./metrics";

/** Statuses that are not published yet but belong on the page (the queue). */
export const QUEUE_STATUSES = ["SCHEDULED", "PUBLISHING", "FAILED"] as const;

/**
 * Peers are looked up over at least this many days whatever range the page
 * shows, so switching 30 → 180 days does not change a video's verdict. Same
 * horizon as the snapshot cron's tracking window.
 */
export const PEER_WINDOW_DAYS = 180;

export const SNAPSHOT_SELECT = {
  id: true,
  capturedAt: true,
  views: true,
  reach: true,
  likes: true,
  comments: true,
  saved: true,
  shares: true,
  reposts: true,
  totalInteractions: true,
  avgWatchTimeMs: true,
  totalWatchTimeMs: true,
  skipRatePct: true,
  followersCount: true,
} as const;

export const NOTE =
  "Sekundma-sekund retention Instagram API'da yo'q — skip rate (3 s) va o'rtacha ko'rish % ishlatiladi.";

// ---------------------------------------------------------------------------
// Input (what Prisma returns) and output (JSON-ready) shapes
// ---------------------------------------------------------------------------

export type SnapshotRow = SnapshotNumbers & { id: string; capturedAt: Date };

export interface JiloPostInput {
  id: string;
  status: string;
  mediaType: string;
  caption: string | null;
  scheduledAt: Date;
  publishedAt: Date | null;
  errorMessage: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  meta: unknown;
  instagramAccountId: string;
  instagramAccount: { username: string };
  insightSnapshots: SnapshotRow[];
  analysis: {
    verdict: string;
    text: string;
    model: string | null;
    basedOnSnapshotId: string | null;
    generatedAt: Date;
  } | null;
}

export interface JiloMeta {
  title: string | null;
  jobTitle: string | null;
  job: string | null;
  rank: number | null;
  durationSec: number | null;
  hookSec: number | null;
  hookSource: string | null;
  captionSource: string | null;
  mappingMode: string | null;
  /** Only in the detail view and in needsAnalysis=1 rows. */
  transcriptExcerpt?: string | null;
}

export type JiloSnapshotJson = Omit<SnapshotRow, "capturedAt"> & {
  capturedAt: string;
};

export interface JiloAnalysisJson {
  verdict: string;
  text: string;
  model: string | null;
  basedOnSnapshotId: string | null;
  generatedAt: string;
}

interface JiloBaseRow {
  id: string;
  status: string;
  mediaType: string;
  caption: string | null;
  scheduledAt: string;
  publishedAt: string | null;
  errorMessage: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  accountId: string;
  accountUsername: string;
  /** meta.title, else the caption's first line, else "Jilo reel". */
  title: string;
  meta: JiloMeta;
  latest: JiloSnapshotJson | null;
  snapshotCount: number;
  metrics: DerivedMetrics;
  views24h: number | null;
  views72h: number | null;
  analysis: JiloAnalysisJson | null;
  needsAnalysis: boolean;
}

export interface JiloVideoRow extends JiloBaseRow {
  verdict: ComputedVerdict;
  /** Which number was compared: views at 24h when known, else latest views. */
  verdictBasis: "views24h" | "latestViews" | null;
  verdictValue: number | null;
  /** Median of the peers' verdictValue (same basis rule applied per peer). */
  peerMedian: number | null;
  peerCount: number;
}

export interface JiloVideoDetail extends JiloBaseRow {
  snapshots: JiloSnapshotJson[];
}

export interface JiloTotals {
  videos: number;
  published: number;
  /** SCHEDULED + PUBLISHING. */
  scheduled: number;
  failed: number;
  views: number;
  reach: number;
  avgSkipRatePct: number | null;
  avgRetentionPct: number | null;
  /** Summed over accounts: each account's latest snapshot follower count. */
  followersNow: number | null;
  /** Summed over accounts: each account's earliest snapshot follower count. */
  followersAtCampaignStart: number | null;
  /** Published video with the most (latest) views. */
  bestPostId: string | null;
}

export interface JiloVideosResponse {
  videos: JiloVideoRow[];
  totals: JiloTotals;
  note: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Reads the agent-supplied meta JSON defensively — it is free-form. */
export function readMeta(meta: unknown, includeTranscript = false): JiloMeta {
  const m =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  return {
    title: str(m.title),
    jobTitle: str(m.jobTitle),
    job: str(m.job),
    rank: num(m.rank),
    durationSec: num(m.durationSec),
    hookSec: num(m.hookSec),
    hookSource: str(m.hookSource),
    captionSource: str(m.captionSource),
    mappingMode: str(m.mappingMode),
    ...(includeTranscript ? { transcriptExcerpt: str(m.transcriptExcerpt) } : {}),
  };
}

function snapshotJson(s: SnapshotRow): JiloSnapshotJson {
  return { ...s, capturedAt: s.capturedAt.toISOString() };
}

function displayTitle(meta: JiloMeta, caption: string | null): string {
  if (meta.title) return meta.title;
  const firstLine = caption?.split("\n").find((l) => l.trim())?.trim();
  return firstLine || "Jilo reel";
}

function toBaseRow(
  post: JiloPostInput,
  now: Date,
  includeTranscript: boolean
): JiloBaseRow {
  const snaps = post.insightSnapshots;
  const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const meta = readMeta(post.meta, includeTranscript);

  return {
    id: post.id,
    status: post.status,
    mediaType: post.mediaType,
    caption: post.caption,
    scheduledAt: post.scheduledAt.toISOString(),
    publishedAt: post.publishedAt?.toISOString() ?? null,
    errorMessage: post.errorMessage,
    permalink: post.permalink,
    thumbnailUrl: post.thumbnailUrl,
    accountId: post.instagramAccountId,
    accountUsername: post.instagramAccount.username,
    title: displayTitle(meta, post.caption),
    meta,
    latest: latest ? snapshotJson(latest) : null,
    snapshotCount: snaps.length,
    metrics: deriveMetrics({ durationSec: meta.durationSec, snap: latest }),
    views24h: valueAtAge(snaps, post.publishedAt, 24, "views"),
    views72h: valueAtAge(snaps, post.publishedAt, 72, "views"),
    analysis: post.analysis
      ? {
          verdict: post.analysis.verdict,
          text: post.analysis.text,
          model: post.analysis.model,
          basedOnSnapshotId: post.analysis.basedOnSnapshotId,
          generatedAt: post.analysis.generatedAt.toISOString(),
        }
      : null,
    needsAnalysis: needsAnalysis({
      status: post.status,
      publishedAt: post.publishedAt,
      latestSnapshot: latest,
      analysis: post.analysis,
      snapshots: snaps,
      now,
    }),
  };
}

function mean(values: Array<number | null>): number | null {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (nums.length === 0) return null;
  return round3(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export function buildVideoDetail(post: JiloPostInput, now: Date): JiloVideoDetail {
  return {
    ...toBaseRow(post, now, true),
    snapshots: post.insightSnapshots.map(snapshotJson),
  };
}

/**
 * Builds the list rows and campaign totals.
 *
 * `posts` should cover the peer window (≥ PEER_WINDOW_DAYS); only posts
 * published at or after `since`, plus the queue (scheduled / publishing /
 * failed), are returned and counted in the totals.
 *
 * Verdict rule: a video is judged only once it is PUBLISHED and ≥ 24h old.
 * Its value is views at 24h (valueAtAge) when known, else its latest views.
 * Peers are the OTHER published Jilo videos of the same Instagram account that
 * are also ≥ 24h old, each valued by that same rule. verdictFor() then
 * compares against the peers' median (≥ 2× UCHDI, ≤ 0.5× UCHMADI, < 3 peers
 * KUTILMOQDA).
 */
export function buildJiloReport(
  posts: JiloPostInput[],
  { now, since, includeTranscript = false }: {
    now: Date;
    since: Date;
    includeTranscript?: boolean;
  }
): { videos: JiloVideoRow[]; totals: JiloTotals } {
  const base = posts.map((post) => {
    const row = toBaseRow(post, now, includeTranscript);
    const eligible =
      post.status === "PUBLISHED" &&
      post.publishedAt !== null &&
      now.getTime() - post.publishedAt.getTime() >= MIN_AGE_FOR_VERDICT_MS;

    let verdictValue: number | null = null;
    let verdictBasis: JiloVideoRow["verdictBasis"] = null;
    if (eligible) {
      if (row.views24h !== null) {
        verdictValue = row.views24h;
        verdictBasis = "views24h";
      } else if (row.latest?.views != null) {
        verdictValue = row.latest.views;
        verdictBasis = "latestViews";
      }
    }
    return { post, row, verdictValue, verdictBasis };
  });

  const rows: Array<{ post: JiloPostInput; row: JiloVideoRow }> = base.map(
    ({ post, row, verdictValue, verdictBasis }) => {
      const peerValues = base
        .filter(
          (other) =>
            other.post.id !== post.id &&
            other.post.instagramAccountId === post.instagramAccountId &&
            other.verdictValue !== null
        )
        .map((other) => other.verdictValue as number);

      return {
        post,
        row: {
          ...row,
          verdict: verdictFor({ value: verdictValue, peerValues }),
          verdictBasis,
          verdictValue,
          peerMedian: median(peerValues),
          peerCount: peerValues.length,
        },
      };
    }
  );

  const queue = new Set<string>(QUEUE_STATUSES);
  const shown = rows
    .filter(
      ({ post }) =>
        queue.has(post.status) ||
        (post.publishedAt !== null && post.publishedAt.getTime() >= since.getTime())
    )
    .sort((a, b) => sortTime(b.post) - sortTime(a.post));

  return {
    videos: shown.map(({ row }) => row),
    totals: computeTotals(shown),
  };
}

function sortTime(post: JiloPostInput): number {
  return (post.publishedAt ?? post.scheduledAt).getTime();
}

function computeTotals(
  shown: Array<{ post: JiloPostInput; row: JiloVideoRow }>
): JiloTotals {
  const published = shown.filter(({ row }) => row.status === "PUBLISHED");

  let best: JiloVideoRow | null = null;
  for (const { row } of published) {
    const v = row.latest?.views;
    if (typeof v !== "number") continue;
    if (!best || v > (best.latest?.views ?? -1)) best = row;
  }

  // Followers are account-level: take each account's earliest and latest
  // capture across its videos, then add the accounts up.
  const byAccount = new Map<
    string,
    { first: { t: number; n: number } | null; last: { t: number; n: number } | null }
  >();
  for (const { post } of shown) {
    for (const s of post.insightSnapshots) {
      if (typeof s.followersCount !== "number") continue;
      const t = s.capturedAt.getTime();
      const acc = byAccount.get(post.instagramAccountId) ?? { first: null, last: null };
      if (!acc.first || t < acc.first.t) acc.first = { t, n: s.followersCount };
      if (!acc.last || t > acc.last.t) acc.last = { t, n: s.followersCount };
      byAccount.set(post.instagramAccountId, acc);
    }
  }
  let followersNow: number | null = null;
  let followersAtCampaignStart: number | null = null;
  for (const { first, last } of byAccount.values()) {
    if (first && last) {
      followersNow = (followersNow ?? 0) + last.n;
      followersAtCampaignStart = (followersAtCampaignStart ?? 0) + first.n;
    }
  }

  return {
    videos: shown.length,
    published: published.length,
    scheduled: shown.filter(
      ({ row }) => row.status === "SCHEDULED" || row.status === "PUBLISHING"
    ).length,
    failed: shown.filter(({ row }) => row.status === "FAILED").length,
    views: published.reduce((sum, { row }) => sum + (row.latest?.views ?? 0), 0),
    reach: published.reduce((sum, { row }) => sum + (row.latest?.reach ?? 0), 0),
    avgSkipRatePct: mean(published.map(({ row }) => row.latest?.skipRatePct ?? null)),
    avgRetentionPct: mean(published.map(({ row }) => row.metrics.retentionPct)),
    followersNow,
    followersAtCampaignStart,
    bestPostId: best?.id ?? null,
  };
}
