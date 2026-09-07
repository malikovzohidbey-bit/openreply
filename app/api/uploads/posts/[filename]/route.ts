import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { parseRange } from "@/lib/posts/range";

// Matches the storage location in app/api/posts/route.ts — kept outside
// /public on purpose (see the comment there for why).
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "posts");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/**
 * Serves uploaded post media, reading from disk on every request. This is
 * public and unauthenticated on purpose: Instagram's Content Publishing API
 * fetches image_url/video_url itself from its own servers, so it can't carry
 * our session cookie. Filenames are random UUIDs, which is the only
 * "access control" a publicly-fetchable media URL can have anyway — the
 * same constraint every self-hosted Content Publishing integration has.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Reject path traversal / anything that isn't a bare filename.
  if (filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXT[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const range = request.headers.get("range");
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  const parsed = parseRange(range, fileStat.size);

  // A start past the end of the file (or a reversed range) would make
  // createReadStream throw, turning a seek into a 500. HTTP has an answer for
  // this case, so give it: 416 with the real size.
  if (parsed.kind === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileStat.size}` },
    });
  }

  if (parsed.kind === "partial") {
    const { start, end } = parsed;
    headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    headers.set("Content-Length", String(end - start + 1));

    const stream = createReadStream(filePath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(fileStat.size));
  const stream = createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}
