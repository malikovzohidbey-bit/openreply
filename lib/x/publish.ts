import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db/client";
import { createPost, getXCredentials, uploadMedia } from "@/lib/x/client";

export const X_UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "x");

export const X_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Publish one XPost. Same atomic-claim pattern as lib/posts/publish.ts: the
 * cron fires every minute, so only the caller that flips SCHEDULED →
 * PUBLISHING proceeds, which rules out a duplicate post on the real account.
 */
export async function publishXPost(postId: string): Promise<void> {
  const claimed = await prisma.xPost.updateMany({
    where: { id: postId, status: "SCHEDULED" },
    data: { status: "PUBLISHING", errorMessage: null },
  });
  if (claimed.count === 0) return;

  const post = await prisma.xPost.findUnique({ where: { id: postId } });
  if (!post) return;

  try {
    const creds = getXCredentials();
    const mediaIds: string[] = [];

    if (post.mediaPath) {
      const filename = path.basename(post.mediaPath);
      const mime = X_MIME_BY_EXT[path.extname(filename).toLowerCase()];
      if (!mime) throw new Error(`Noma'lum rasm turi: ${filename}`);
      const bytes = await readFile(path.join(X_UPLOAD_DIR, filename));
      mediaIds.push(await uploadMedia(creds, bytes, mime));
    }

    const result = await createPost(creds, post.text, mediaIds);

    await prisma.xPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        tweetId: result.id,
        errorMessage: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Noma'lum xato";
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000) },
    });
  }
}
