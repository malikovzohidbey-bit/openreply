import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishXPost } from "@/lib/x/publish";

/** A text post takes seconds; anything in PUBLISHING this long was orphaned
 *  by a restart mid-request, not still working. */
const STUCK_PUBLISHING_MS = 10 * 60 * 1000;
const BATCH_SIZE = 5;

/** Runs every minute from the host crontab, like publish-scheduled-posts. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const recovered = await prisma.xPost.updateMany({
    where: {
      status: "PUBLISHING",
      updatedAt: { lte: new Date(Date.now() - STUCK_PUBLISHING_MS) },
    },
    data: { status: "SCHEDULED" },
  });

  const due = await prisma.xPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  });

  await Promise.allSettled(due.map((post) => publishXPost(post.id)));

  return NextResponse.json({
    success: true,
    data: { processed: due.length, recovered: recovered.count },
  });
}
