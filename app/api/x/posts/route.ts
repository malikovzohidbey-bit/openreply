import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getMissingXEnv } from "@/lib/x/client";
import { X_UPLOAD_DIR } from "@/lib/x/publish";

// X's own limits: 5 MB for images, 15 MB for GIFs.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_GIF_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const itemsSchema = z
  .array(
    z.object({
      text: z.string().trim().min(1).max(4000),
      scheduledAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: "Joylash vaqti noto'g'ri",
      }),
      fileIndex: z.number().int().min(0).nullable(),
    })
  )
  .min(1)
  .max(200);

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  const posts = await prisma.xPost.findMany({
    where: {
      workspaceId,
      ...(start && end
        ? { scheduledAt: { gte: new Date(start), lte: new Date(end) } }
        : {}),
    },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json({
    success: true,
    data: posts,
    missingEnv: getMissingXEnv(),
  });
}

export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const itemsRaw = form.get("items");
  if (typeof itemsRaw !== "string") {
    return NextResponse.json({ success: false, error: "items kerak" }, { status: 400 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(itemsRaw);
  } catch {
    return NextResponse.json({ success: false, error: "items JSON emas" }, { status: 400 });
  }
  const parsed = itemsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Noto'g'ri ma'lumot" },
      { status: 400 }
    );
  }
  const items = parsed.data;

  // Validate every file before writing any, so a bad one doesn't leave
  // orphans on disk for the others.
  const files = new Map<number, { file: File; ext: string }>();
  for (const item of items) {
    if (item.fileIndex === null || files.has(item.fileIndex)) continue;
    const file = form.get(`file-${item.fileIndex}`);
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: `Rasm topilmadi (post #${item.fileIndex + 1})` },
        { status: 400 }
      );
    }
    const ext = EXT_BY_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        { success: false, error: "Faqat JPG/PNG/GIF/WEBP rasm qo'llab-quvvatlanadi" },
        { status: 400 }
      );
    }
    const limit = file.type === "image/gif" ? MAX_GIF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > limit) {
      return NextResponse.json(
        { success: false, error: `Rasm juda katta (max ${limit / 1024 / 1024} MB)` },
        { status: 400 }
      );
    }
    files.set(item.fileIndex, { file, ext });
  }

  await mkdir(X_UPLOAD_DIR, { recursive: true });
  const written: string[] = [];
  const pathByIndex = new Map<number, string>();
  try {
    for (const [index, { file, ext }] of files) {
      const filename = `${randomUUID()}.${ext}`;
      await writeFile(path.join(X_UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));
      written.push(filename);
      pathByIndex.set(index, `/api/uploads/x/${filename}`);
    }

    const created = await prisma.$transaction(
      items.map((item) =>
        prisma.xPost.create({
          data: {
            workspaceId,
            text: item.text,
            mediaPath: item.fileIndex === null ? null : pathByIndex.get(item.fileIndex) ?? null,
            scheduledAt: new Date(item.scheduledAt),
            status: "SCHEDULED",
          },
        })
      )
    );

    return NextResponse.json({ success: true, data: created });
  } catch (error) {
    await Promise.allSettled(
      written.map((filename) => unlink(path.join(X_UPLOAD_DIR, filename)))
    );
    const message = error instanceof Error ? error.message : "Saqlashda xato";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
