import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { publishXPost } from "@/lib/x/publish";

/** "Hozir yubor": publish a scheduled or failed post right away. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.xPost.findFirst({ where: { id, workspaceId } });
  if (!post) {
    return NextResponse.json({ success: false, error: "Topilmadi" }, { status: 404 });
  }
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") {
    return NextResponse.json(
      { success: false, error: "Bu post allaqachon chop etilgan" },
      { status: 400 }
    );
  }

  if (post.status === "FAILED") {
    await prisma.xPost.update({
      where: { id },
      data: { status: "SCHEDULED", errorMessage: null },
    });
  }

  await publishXPost(id);
  const updated = await prisma.xPost.findUnique({ where: { id } });
  return NextResponse.json({ success: true, data: updated });
}
