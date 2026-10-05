import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { X_UPLOAD_DIR } from "@/lib/x/publish";

export async function PATCH(
  request: NextRequest,
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
      { success: false, error: "Chop etilgan postni o'zgartirib bo'lmaydi" },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; scheduledAt?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ success: false, error: "JSON kerak" }, { status: 400 });
  }

  const data: { text?: string; scheduledAt?: Date; status?: "SCHEDULED"; errorMessage?: null } = {};
  if (typeof body.text === "string") {
    const text = body.text.trim();
    if (!text || text.length > 4000) {
      return NextResponse.json({ success: false, error: "Matn bo'sh yoki juda uzun" }, { status: 400 });
    }
    data.text = text;
  }
  if (typeof body.scheduledAt === "string") {
    const when = new Date(body.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ success: false, error: "Vaqt noto'g'ri" }, { status: 400 });
    }
    data.scheduledAt = when;
  }
  // Editing a failed post re-queues it; the error it carried no longer applies.
  if (post.status === "FAILED" && (data.text !== undefined || data.scheduledAt !== undefined)) {
    data.status = "SCHEDULED";
    data.errorMessage = null;
  }

  const updated = await prisma.xPost.update({ where: { id }, data });
  return NextResponse.json({ success: true, data: updated });
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
  const post = await prisma.xPost.findFirst({ where: { id, workspaceId } });
  if (!post) {
    return NextResponse.json({ success: false, error: "Topilmadi" }, { status: 404 });
  }
  if (post.status === "PUBLISHING") {
    return NextResponse.json(
      { success: false, error: "Chop etilayotgan postni o'chirib bo'lmaydi" },
      { status: 400 }
    );
  }

  await prisma.xPost.delete({ where: { id } });

  if (post.mediaPath) {
    try {
      await unlink(path.join(X_UPLOAD_DIR, path.basename(post.mediaPath)));
    } catch {
      // Already gone — the DB row was the source of truth.
    }
  }

  return NextResponse.json({ success: true });
}
