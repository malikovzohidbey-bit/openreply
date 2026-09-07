import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getBaseUrl } from "@/lib/env";
import {
  createMediaContainer,
  getContainerStatus,
  publishMediaContainer,
  MetaApiError,
} from "@/lib/meta/client";

const CONTAINER_POLL_INTERVAL_MS = 3000;
// Reels/video processing on Instagram's side is usually done in under a
// minute; this is a generous ceiling before we give up and mark the post
// failed rather than hang the caller forever.
const CONTAINER_POLL_MAX_MS = 180_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one Post through Instagram's two-step Content Publishing flow
 * (create container, wait for it to finish processing, publish) and record
 * the outcome on the row. Used both by the "publish now" API route and by
 * the scheduled-posts cron — same code path either way.
 */
export async function publishPost(postId: string): Promise<void> {
  // Claim the post atomically before touching Instagram. The cron fires every
  // minute while a single video can take minutes to publish, so without this
  // two overlapping runs can both pick up the same SCHEDULED row and publish
  // it twice — a duplicate post on a real account, which cannot be undone.
  // Only a row still in SCHEDULED flips to PUBLISHING, and only the caller
  // that won the flip proceeds.
  const claimed = await prisma.post.updateMany({
    where: { id: postId, status: "SCHEDULED" },
    data: { status: "PUBLISHING", errorMessage: null },
  });
  if (claimed.count === 0) return;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { instagramAccount: true },
  });
  if (!post) return;

  try {
    const accessToken = decryptToken(post.instagramAccount.accessToken);
    const igUserId = post.instagramAccount.instagramId;
    const mediaUrl = `${getBaseUrl()}${post.filePath}`;

    const container = await createMediaContainer(accessToken, igUserId, {
      imageUrl: post.mediaType === "IMAGE" ? mediaUrl : undefined,
      videoUrl: post.mediaType !== "IMAGE" ? mediaUrl : undefined,
      mediaType: post.mediaType === "REEL" ? "REELS" : undefined,
      caption: post.caption ?? undefined,
      trialReel:
        post.mediaType === "REEL" && post.isTrialReel
          ? {
              graduationStrategy:
                (post.graduationStrategy as "MANUAL" | "SS_PERFORMANCE") ??
                "SS_PERFORMANCE",
            }
          : undefined,
    });

    await prisma.post.update({
      where: { id: post.id },
      data: { containerId: container.id },
    });

    // Images publish immediately; video/reel containers need processing time.
    if (post.mediaType !== "IMAGE") {
      const deadline = Date.now() + CONTAINER_POLL_MAX_MS;
      for (;;) {
        const { status_code } = await getContainerStatus(
          accessToken,
          container.id
        );
        if (status_code === "FINISHED") break;
        if (status_code === "ERROR" || status_code === "EXPIRED") {
          throw new Error(
            `Instagram konteyner qayta ishlanmadi (status: ${status_code})`
          );
        }
        if (Date.now() > deadline) {
          throw new Error(
            "Instagram videoni qayta ishlash vaqti tugadi (3 daqiqa)"
          );
        }
        await sleep(CONTAINER_POLL_INTERVAL_MS);
      }
    }

    const published = await publishMediaContainer(
      accessToken,
      igUserId,
      container.id
    );

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        igMediaId: published.id,
        publishedAt: new Date(),
      },
    });
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Noma'lum xatolik";
    console.error(`[Avtopost] Post ${post.id} failed:`, message);
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: message },
    });
  }
}
