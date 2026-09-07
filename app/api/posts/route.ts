import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { prisma } from "@/lib/db/client";
import { publishPost } from "@/lib/posts/publish";

// Deliberately outside /public: Next.js's static file server snapshots
// /public at boot in this version, so a file dropped there after startup
// 404s until the process restarts — a non-starter for uploads. Serving these
// through our own route (app/api/uploads/posts/[filename]) reads from disk
// on every request instead, so newly uploaded files work immediately.
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "posts");

// Instagram's own limits are far higher; this just keeps a single self-hosted
// box from being asked to buffer something absurd in memory.
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function mediaTypeFromMime(mime: string, isReel: boolean): "IMAGE" | "VIDEO" | "REEL" | null {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return isReel ? "REEL" : "VIDEO";
  return null;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  const posts = await prisma.post.findMany({
    where: {
      workspaceId,
      ...(start && end
        ? { scheduledAt: { gte: new Date(start), lte: new Date(end) } }
        : {}),
    },
    include: { instagramAccount: { select: { username: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json({ success: true, data: posts });
}

export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const instagramAccountId = form.get("instagramAccountId");
  const caption = form.get("caption");
  const scheduledAtRaw = form.get("scheduledAt");
  const isReel = form.get("isReel") === "true";
  const isTrialReel = form.get("isTrialReel") === "true";
  const graduationStrategyRaw = form.get("graduationStrategy");
  const graduationStrategy =
    graduationStrategyRaw === "MANUAL" ? "MANUAL" : "SS_PERFORMANCE";

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Fayl tanlanmagan" }, { status: 400 });
  }
  if (typeof instagramAccountId !== "string" || !instagramAccountId) {
    return NextResponse.json({ success: false, error: "Akkaunt tanlanmagan" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: "Fayl juda katta (max 200 MB)" },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram akkaunt topilmadi" },
      { status: 400 }
    );
  }

  const mediaType = mediaTypeFromMime(file.type, isReel);
  const ext = EXT_BY_MIME[file.type];
  if (!mediaType || !ext) {
    return NextResponse.json(
      { success: false, error: "Faqat JPG/PNG rasm yoki MP4/MOV video qo'llab-quvvatlanadi" },
      { status: 400 }
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  const filePath = `/api/uploads/posts/${filename}`;

  const scheduledAt = scheduledAtRaw && typeof scheduledAtRaw === "string"
    ? new Date(scheduledAtRaw)
    : new Date();
  const isImmediate = scheduledAt.getTime() <= Date.now() + 5000;

  const post = await prisma.post.create({
    data: {
      workspaceId,
      instagramAccountId: account.id,
      mediaType,
      filePath,
      caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
      scheduledAt,
      status: "SCHEDULED",
      isTrialReel: mediaType === "REEL" ? isTrialReel : false,
      graduationStrategy: mediaType === "REEL" && isTrialReel ? graduationStrategy : null,
    },
  });

  // Fire-and-forget: video processing can take up to a couple minutes, so the
  // client polls GET /api/posts/[id] for status rather than waiting here.
  if (isImmediate) {
    void publishPost(post.id);
  }

  return NextResponse.json({ success: true, data: post });
}
