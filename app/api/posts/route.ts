import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { resolveWorkspaceId } from "@/lib/api-auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import type { Prisma } from "@/app/generated/prisma/client";
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

// Creator metadata rides along as a JSON string; enough for a transcript
// excerpt and a handful of fields, small enough never to matter in Postgres.
const MAX_META_BYTES = 8 * 1024;

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
  const workspaceId = await resolveWorkspaceId(request);
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
  const workspaceId = await resolveWorkspaceId(request);
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

  // Who made this post and what they know about it. An external agent (the
  // Jilo reels pipeline) tags its uploads so the analytics page can tell them
  // apart from UI uploads and show hook/caption context next to the numbers.
  const sourceRaw = form.get("source");
  const source =
    typeof sourceRaw === "string" && /^[a-z0-9_-]{1,32}$/i.test(sourceRaw.trim())
      ? sourceRaw.trim().toLowerCase()
      : null;
  const metaRaw = form.get("meta");
  let meta: Prisma.InputJsonObject | null = null;
  if (typeof metaRaw === "string" && metaRaw.trim()) {
    if (metaRaw.length > MAX_META_BYTES) {
      return NextResponse.json(
        { success: false, error: "meta juda katta (max 8 KB)" },
        { status: 400 }
      );
    }
    try {
      const parsed: unknown = JSON.parse(metaRaw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      meta = parsed as Prisma.InputJsonObject;
    } catch {
      return NextResponse.json(
        { success: false, error: "meta JSON obyekt bo'lishi kerak" },
        { status: 400 }
      );
    }
  }

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

  // Validated before the file is written: bailing out afterwards would leave
  // an orphaned upload on disk that nothing ever cleans up, since the cleanup
  // cron only knows about files a Post row points at.
  let scheduledAt = new Date();
  if (scheduledAtRaw && typeof scheduledAtRaw === "string") {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { success: false, error: "Joylash vaqti noto'g'ri" },
        { status: 400 }
      );
    }
    scheduledAt = parsed;
  }
  const isImmediate = scheduledAt.getTime() <= Date.now() + 5000;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  const filePath = `/api/uploads/posts/${filename}`;

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
      source,
      ...(meta ? { meta } : {}),
    },
  });

  // Fire-and-forget: video processing can take up to a couple minutes, so the
  // client polls GET /api/posts/[id] for status rather than waiting here.
  if (isImmediate) {
    void publishPost(post.id);
  }

  return NextResponse.json({ success: true, data: post });
}
