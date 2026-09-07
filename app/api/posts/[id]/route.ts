import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, workspaceId },
    include: { instagramAccount: { select: { username: true } } },
  });

  if (!post) {
    return NextResponse.json({ success: false, error: "Topilmadi" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: post });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({ where: { id, workspaceId } });
  if (!post) {
    return NextResponse.json({ success: false, error: "Topilmadi" }, { status: 404 });
  }
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") {
    return NextResponse.json(
      { success: false, error: "Chop etilgan yoki chop etilayotgan postni o'chirib bo'lmaydi" },
      { status: 400 }
    );
  }

  await prisma.post.delete({ where: { id } });

  try {
    // filePath is "/api/uploads/posts/<filename>" — the actual file lives
    // outside /public (see app/api/posts/route.ts for why).
    const filename = path.basename(post.filePath);
    await unlink(path.join(process.cwd(), "data", "uploads", "posts", filename));
  } catch {
    // File already gone — fine, the DB row is the source of truth.
  }

  return NextResponse.json({ success: true });
}
