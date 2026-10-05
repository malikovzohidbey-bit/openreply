import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { X_MIME_BY_EXT, X_UPLOAD_DIR } from "@/lib/x/publish";

/**
 * Serves X post images for the dashboard preview only. Unlike Instagram
 * uploads these never need to be publicly fetchable — the bytes go to X
 * straight from disk — so this route requires a signed-in session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename } = await params;
  if (filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const contentType = X_MIME_BY_EXT[path.extname(filename).toLowerCase()];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(X_UPLOAD_DIR, filename));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
