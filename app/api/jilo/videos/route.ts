import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceId } from "@/lib/api-auth";
import { prisma } from "@/lib/db/client";
import {
  buildJiloReport,
  NOTE,
  PEER_WINDOW_DAYS,
  QUEUE_STATUSES,
  SNAPSHOT_SELECT,
  type JiloVideosResponse,
} from "@/lib/jilo/videos";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

function parseDays(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

/**
 * Jilo agent uploads with their latest insights, derived ratios, a verdict
 * against the account's other Jilo videos, and campaign totals.
 *
 * ?accountId=<InstagramAccount.id|all>  ?days=<1..365, default 90>
 * ?needsAnalysis=1 → only videos the external analyzer should (re)write a
 *   "why did it work" text for, with the transcript excerpt included.
 *
 * Auth: session or `Authorization: Bearer POSTS_API_KEY` (lib/api-auth.ts).
 */
export async function GET(request: NextRequest) {
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const accountIdRaw = params.get("accountId");
  const accountId = accountIdRaw && accountIdRaw !== "all" ? accountIdRaw : null;
  const days = parseDays(params.get("days"));
  const onlyNeedsAnalysis = params.get("needsAnalysis") === "1";

  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  // Loaded wider than the displayed range so verdicts compare against the
  // same peers whatever range is selected (see PEER_WINDOW_DAYS).
  const peerSince = new Date(
    now.getTime() - Math.max(days, PEER_WINDOW_DAYS) * DAY_MS
  );

  const posts = await prisma.post.findMany({
    where: {
      workspaceId,
      source: "jilo",
      ...(accountId ? { instagramAccountId: accountId } : {}),
      OR: [
        { publishedAt: { gte: peerSince } },
        { status: { in: [...QUEUE_STATUSES] } },
      ],
    },
    include: {
      instagramAccount: { select: { username: true } },
      insightSnapshots: {
        orderBy: { capturedAt: "asc" },
        select: SNAPSHOT_SELECT,
      },
      analysis: true,
    },
    orderBy: { scheduledAt: "desc" },
  });

  const { videos, totals } = buildJiloReport(posts, {
    now,
    since,
    includeTranscript: onlyNeedsAnalysis,
  });

  const data: JiloVideosResponse = {
    videos: onlyNeedsAnalysis ? videos.filter((v) => v.needsAnalysis) : videos,
    totals,
    note: NOTE,
  };

  return NextResponse.json({ success: true, data });
}
