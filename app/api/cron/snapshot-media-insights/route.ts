import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getMediaFields, getUserInfo } from "@/lib/meta/client";
import { isSnapshotDue } from "@/lib/insights/cadence";
import { fetchMediaInsightGroups } from "@/lib/insights/fetch-media-insights";

// Instagram stops being interesting about a post long before this; past it the
// weekly capture is just API quota spent on numbers nobody looks at.
const TRACKING_WINDOW_DAYS = 180;

// Each due post costs 1-4 insight calls. A cap keeps one run inside the
// scheduler's timeout; whatever is left stays due and goes first next hour.
const MAX_POSTS_PER_RUN = 100;

/**
 * Records a point-in-time copy of every published post's insights, on a
 * cadence that thins out as the post ages (see lib/insights/cadence.ts).
 *
 * Instagram only ever returns lifetime totals — never "views at hour 3". The
 * growth curve of a reel, and the answer to "did it take off in the first two
 * hours or crawl for a week", exists only because this job writes a row each
 * time it looks. A missed hour in the first 48h is gone for good.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const now = new Date();
  const since = new Date(now.getTime() - TRACKING_WINDOW_DAYS * 86_400_000);

  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      igMediaId: { not: null },
      publishedAt: { not: null, gte: since },
    },
    include: {
      instagramAccount: {
        select: {
          id: true,
          workspaceId: true,
          username: true,
          instagramId: true,
          accessToken: true,
        },
      },
      insightSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { capturedAt: true },
      },
    },
  });

  const dueQueue = posts
    .map((post) => ({
      post,
      publishedAt: post.publishedAt,
      igMediaId: post.igMediaId,
      lastCapturedAt: post.insightSnapshots[0]?.capturedAt ?? null,
    }))
    .filter(
      (
        entry
      ): entry is typeof entry & { publishedAt: Date; igMediaId: string } =>
        entry.publishedAt !== null &&
        entry.igMediaId !== null &&
        isSnapshotDue(entry.publishedAt, entry.lastCapturedAt, now)
    );

  // Never-captured posts first, then whoever has waited longest.
  const queue = [...dueQueue]
    .sort(
      (a, b) =>
        (a.lastCapturedAt?.getTime() ?? 0) - (b.lastCapturedAt?.getTime() ?? 0)
    )
    .slice(0, MAX_POSTS_PER_RUN);

  // Follower total is account-level context stored on every snapshot. One call
  // per account per run, not one per post; a failure caches as null so a bad
  // account is not retried for each of its posts.
  const followersByAccount = new Map<string, number | null>();

  let snapshots = 0;
  const failures: Array<{ postId: string; reason: string }> = [];

  for (const { post, igMediaId } of queue) {
    try {
      const account = post.instagramAccount;
      const token = decryptToken(account.accessToken);

      if (!followersByAccount.has(account.id)) {
        let followers: number | null = null;
        try {
          const info = await getUserInfo(token);
          if (typeof info.followers_count === "number") {
            followers = info.followers_count;
          }
        } catch {
          followers = null;
        }
        followersByAccount.set(account.id, followers);
      }

      // The permalink is only needed once; the post row keeps it from then on.
      if (!post.permalink) {
        try {
          const fields = await getMediaFields(token, igMediaId, [
            "permalink",
            "thumbnail_url",
          ]);
          const permalink =
            typeof fields.permalink === "string" ? fields.permalink : null;
          const thumbnailUrl =
            typeof fields.thumbnail_url === "string"
              ? fields.thumbnail_url
              : null;

          if (permalink || thumbnailUrl) {
            await prisma.post.update({
              where: { id: post.id },
              data: {
                ...(permalink ? { permalink } : {}),
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
              },
            });
          }
        } catch {
          // Cosmetic data: the snapshot is worth more than the link.
        }
      }

      const { metrics, errors } = await fetchMediaInsightGroups(
        token,
        igMediaId,
        post.mediaType
      );

      // Nothing came back at all (expired token, deleted media): writing an
      // empty row would mark the post "captured" and silence it until the next
      // cadence step — up to a week for an older post. Fail instead so it is
      // retried next hour and the reason lands in the operational log.
      if (Object.keys(metrics).length === 0 && Object.keys(errors).length > 0) {
        throw new Error(
          `All metric groups failed: ${Object.values(errors).join("; ")}`
        );
      }

      await prisma.mediaInsightSnapshot.create({
        data: {
          postId: post.id,
          igMediaId,
          views: toInt(metrics.views),
          reach: toInt(metrics.reach),
          likes: toInt(metrics.likes),
          comments: toInt(metrics.comments),
          saved: toInt(metrics.saved),
          shares: toInt(metrics.shares),
          reposts: toInt(metrics.reposts),
          totalInteractions: toInt(metrics.total_interactions),
          avgWatchTimeMs: toInt(metrics.ig_reels_avg_watch_time),
          totalWatchTimeMs: toFloat(metrics.ig_reels_video_view_total_time),
          skipRatePct: toFloat(metrics.reels_skip_rate),
          followersCount: followersByAccount.get(account.id) ?? null,
          errors: Object.keys(errors).length > 0 ? errors : undefined,
          raw: metrics,
        },
      });
      snapshots += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      failures.push({ postId: post.id, reason });
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "WARNING",
            workspaceId: post.instagramAccount.workspaceId,
            message: "Media insight snapshot failed",
            payload: { postId: post.id, igMediaId, reason },
          },
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      candidates: posts.length,
      due: dueQueue.length,
      snapshots,
      failures,
    },
  });
}

// Meta returns whole numbers for counts, but a column typed Int rejects the
// whole insert on a fractional value — round rather than lose the snapshot.
function toInt(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function toFloat(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
