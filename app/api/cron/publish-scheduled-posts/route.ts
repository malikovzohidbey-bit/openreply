import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishPost } from "@/lib/posts/publish";

/** Longest a post can legitimately sit in PUBLISHING: the container poll in
 *  publishPost gives up after 3 minutes, so anything past this was orphaned
 *  by a restart mid-publish rather than still working. */
const STUCK_PUBLISHING_MS = 15 * 60 * 1000;

/** Kept small on purpose: publishPost claims each row atomically, so whatever
 *  this run doesn't reach is simply picked up by the next minute's run. That
 *  keeps a single slow video from holding this request open for minutes. */
const BATCH_SIZE = 5;

/**
 * Runs every minute to catch posts whose scheduled time has arrived.
 * Immediate "post now" publishes are kicked off directly from the create
 * route, so this only ever picks up posts scheduled for later — plus any
 * left stranded in PUBLISHING by a restart.
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

  // Un-stick anything abandoned mid-publish so it becomes claimable again.
  const recovered = await prisma.post.updateMany({
    where: {
      status: "PUBLISHING",
      updatedAt: { lte: new Date(Date.now() - STUCK_PUBLISHING_MS) },
    },
    data: { status: "SCHEDULED" },
  });

  const due = await prisma.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  });

  // In parallel: each publishPost claims its own row, so a slow one cannot
  // delay the others and no row can be picked up twice.
  await Promise.allSettled(due.map((post) => publishPost(post.id)));

  return NextResponse.json({
    success: true,
    data: { processed: due.length, recovered: recovered.count },
  });
}
