import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishPost } from "@/lib/posts/publish";

/**
 * Runs frequently (see the system cron entry) to catch posts whose scheduled
 * time has arrived. Immediate "post now" publishes are kicked off directly
 * from the create route, so this only ever picks up posts that were actually
 * scheduled for later.
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

  const due = await prisma.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 20,
  });

  for (const post of due) {
    await publishPost(post.id);
  }

  return NextResponse.json({ success: true, data: { processed: due.length } });
}
