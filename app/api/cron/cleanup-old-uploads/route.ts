import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db/client";

const RETENTION_DAYS = 7;
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "posts");

/**
 * Deletes the on-disk file for posts whose upload has done its job and is
 * just taking up space: published more than a week ago (Instagram already
 * hosts its own copy by then) or failed more than a week ago (nobody's going
 * to retry a stale upload). The Post row itself is kept for history/logs —
 * only the file goes.
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

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.post.findMany({
    where: {
      filePath: { not: "" },
      OR: [
        { status: "PUBLISHED", publishedAt: { lte: cutoff } },
        { status: "FAILED", createdAt: { lte: cutoff } },
      ],
    },
    select: { id: true, filePath: true },
  });

  let deleted = 0;
  for (const post of candidates) {
    const filename = path.basename(post.filePath);
    try {
      await unlink(path.join(UPLOAD_DIR, filename));
      deleted++;
    } catch {
      // Already gone — fine, nothing left to clean up for this row.
    }
    // Clear the pointer either way: it keeps this query from re-examining the
    // same rows every night, and lets the UI say "media deleted" instead of
    // rendering a player against a URL that now 404s.
    await prisma.post.update({
      where: { id: post.id },
      data: { filePath: "" },
    });
  }

  return NextResponse.json({
    success: true,
    data: { checked: candidates.length, deleted },
  });
}
