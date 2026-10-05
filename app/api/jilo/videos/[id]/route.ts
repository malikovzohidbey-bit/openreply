import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceId } from "@/lib/api-auth";
import { prisma } from "@/lib/db/client";
import { buildVideoDetail, NOTE, SNAPSHOT_SELECT } from "@/lib/jilo/videos";

export const runtime = "nodejs";

/**
 * One Jilo video with its full snapshot series (the growth curve), derived
 * ratios, analysis and agent metadata. Another workspace's post — or a post
 * that is not a Jilo upload — is a 404, never a 403, so ids do not leak.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, workspaceId, source: "jilo" },
    include: {
      instagramAccount: { select: { username: true } },
      insightSnapshots: {
        orderBy: { capturedAt: "asc" },
        select: SNAPSHOT_SELECT,
      },
      analysis: true,
    },
  });

  if (!post) {
    return NextResponse.json(
      { success: false, error: "Topilmadi" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { video: buildVideoDetail(post, new Date()), note: NOTE },
  });
}
