import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceId } from "@/lib/api-auth";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

const analysisSchema = z.object({
  verdict: z.enum(["UCHDI", "ORTACHA", "UCHMADI"]),
  text: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1).max(100).optional(),
  basedOnSnapshotId: z.string().min(1).max(64).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function findJiloPost(id: string, workspaceId: string) {
  return prisma.post.findFirst({
    where: { id, workspaceId, source: "jilo" },
    select: { id: true },
  });
}

/**
 * Written by the external analyzer: the "why did it take off / flop" text.
 *
 * basedOnSnapshotId must be one of this post's snapshots; when omitted, the
 * post's latest snapshot is recorded, so the 7-day/20% refresh rule in
 * needsAnalysis() has a baseline to compare against. generatedAt is reset on
 * every write.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = analysisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          "verdict (UCHDI | ORTACHA | UCHMADI) va text (1-2000 belgi) kerak",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const post = await findJiloPost(id, workspaceId);
  if (!post) {
    return NextResponse.json(
      { success: false, error: "Topilmadi" },
      { status: 404 }
    );
  }

  const { verdict, text, model, basedOnSnapshotId } = parsed.data;

  const snapshot = basedOnSnapshotId
    ? await prisma.mediaInsightSnapshot.findFirst({
        where: { id: basedOnSnapshotId, postId: id },
        select: { id: true },
      })
    : await prisma.mediaInsightSnapshot.findFirst({
        where: { postId: id },
        orderBy: { capturedAt: "desc" },
        select: { id: true },
      });

  if (basedOnSnapshotId && !snapshot) {
    return NextResponse.json(
      { success: false, error: "basedOnSnapshotId bu postga tegishli emas" },
      { status: 400 }
    );
  }

  const fields = {
    verdict,
    text,
    model: model ?? null,
    basedOnSnapshotId: snapshot?.id ?? null,
  };

  const analysis = await prisma.postAnalysis.upsert({
    where: { postId: id },
    create: { postId: id, ...fields },
    update: { ...fields, generatedAt: new Date() },
  });

  return NextResponse.json({ success: true, data: analysis });
}

/**
 * Drops the analysis so the external analyzer writes a fresh one on its next
 * run (the page's "Qayta tahlil" button).
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const post = await findJiloPost(id, workspaceId);
  if (!post) {
    return NextResponse.json(
      { success: false, error: "Topilmadi" },
      { status: 404 }
    );
  }

  const { count } = await prisma.postAnalysis.deleteMany({
    where: { postId: id },
  });

  return NextResponse.json({ success: true, data: { deleted: count } });
}
