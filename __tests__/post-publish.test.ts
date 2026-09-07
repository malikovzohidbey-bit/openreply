/**
 * Avtopost Publishing — Unit Tests
 *
 * Covers the two-step Instagram Content Publishing flow (create container,
 * wait for processing, publish) and, most importantly, the atomic claim that
 * stops two overlapping cron runs from publishing the same post twice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockDecryptToken,
  mockCreateMediaContainer,
  mockGetContainerStatus,
  mockPublishMediaContainer,
} = vi.hoisted(() => ({
  mockPrisma: {
    post: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockDecryptToken: vi.fn(),
  mockCreateMediaContainer: vi.fn(),
  mockGetContainerStatus: vi.fn(),
  mockPublishMediaContainer: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "https://example.test" }));
vi.mock("@/lib/meta/client", () => ({
  createMediaContainer: mockCreateMediaContainer,
  getContainerStatus: mockGetContainerStatus,
  publishMediaContainer: mockPublishMediaContainer,
  MetaApiError: class MetaApiError extends Error {},
}));

const { publishPost } = await import("../lib/posts/publish");

function imagePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post_1",
    mediaType: "IMAGE",
    filePath: "/api/uploads/posts/abc.jpg",
    caption: "salom",
    isTrialReel: false,
    graduationStrategy: null,
    instagramAccount: { accessToken: "enc", instagramId: "ig_1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptToken.mockReturnValue("token");
  mockPrisma.post.update.mockResolvedValue({});
  mockCreateMediaContainer.mockResolvedValue({ id: "container_1" });
  mockPublishMediaContainer.mockResolvedValue({ id: "ig_media_1" });
});

describe("publishPost — claiming", () => {
  it("does nothing when another run already claimed the post", async () => {
    // Two cron runs overlap: the second one loses the race and must not
    // publish the same media a second time.
    mockPrisma.post.updateMany.mockResolvedValue({ count: 0 });

    await publishPost("post_1");

    expect(mockPrisma.post.findUnique).not.toHaveBeenCalled();
    expect(mockCreateMediaContainer).not.toHaveBeenCalled();
    expect(mockPublishMediaContainer).not.toHaveBeenCalled();
  });

  it("only claims rows still in SCHEDULED", async () => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.post.findUnique.mockResolvedValue(imagePost());

    await publishPost("post_1");

    expect(mockPrisma.post.updateMany).toHaveBeenCalledWith({
      where: { id: "post_1", status: "SCHEDULED" },
      data: { status: "PUBLISHING", errorMessage: null },
    });
  });
});

describe("publishPost — images", () => {
  beforeEach(() => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });
  });

  it("publishes without waiting on container processing", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(imagePost());

    await publishPost("post_1");

    expect(mockCreateMediaContainer).toHaveBeenCalledWith("token", "ig_1", {
      imageUrl: "https://example.test/api/uploads/posts/abc.jpg",
      videoUrl: undefined,
      mediaType: undefined,
      caption: "salom",
      trialReel: undefined,
    });
    // Images are ready immediately — no status polling.
    expect(mockGetContainerStatus).not.toHaveBeenCalled();
    expect(mockPublishMediaContainer).toHaveBeenCalledWith(
      "token",
      "ig_1",
      "container_1"
    );
  });

  it("records the published media id", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(imagePost());

    await publishPost("post_1");

    const finalUpdate = mockPrisma.post.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data.status).toBe("PUBLISHED");
    expect(finalUpdate.data.igMediaId).toBe("ig_media_1");
    expect(finalUpdate.data.publishedAt).toBeInstanceOf(Date);
  });
});

describe("publishPost — reels", () => {
  beforeEach(() => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });
  });

  it("waits for the container to finish before publishing", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      imagePost({ mediaType: "REEL", filePath: "/api/uploads/posts/v.mp4" })
    );
    mockGetContainerStatus
      .mockResolvedValueOnce({ status_code: "IN_PROGRESS" })
      .mockResolvedValueOnce({ status_code: "FINISHED" });

    await publishPost("post_1");

    expect(mockGetContainerStatus).toHaveBeenCalledTimes(2);
    expect(mockPublishMediaContainer).toHaveBeenCalled();
    expect(mockCreateMediaContainer).toHaveBeenCalledWith(
      "token",
      "ig_1",
      expect.objectContaining({
        videoUrl: "https://example.test/api/uploads/posts/v.mp4",
        mediaType: "REELS",
        imageUrl: undefined,
      })
    );
  });

  it("fails the post when Instagram rejects the container", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      imagePost({ mediaType: "REEL" })
    );
    mockGetContainerStatus.mockResolvedValue({ status_code: "ERROR" });

    await publishPost("post_1");

    expect(mockPublishMediaContainer).not.toHaveBeenCalled();
    const finalUpdate = mockPrisma.post.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data.status).toBe("FAILED");
    expect(finalUpdate.data.errorMessage).toContain("ERROR");
  });

  it("passes trial params only for trial reels", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      imagePost({
        mediaType: "REEL",
        isTrialReel: true,
        graduationStrategy: "MANUAL",
      })
    );
    mockGetContainerStatus.mockResolvedValue({ status_code: "FINISHED" });

    await publishPost("post_1");

    expect(mockCreateMediaContainer).toHaveBeenCalledWith(
      "token",
      "ig_1",
      expect.objectContaining({
        trialReel: { graduationStrategy: "MANUAL" },
      })
    );
  });

  it("defaults a trial reel with no strategy to automatic graduation", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      imagePost({ mediaType: "REEL", isTrialReel: true, graduationStrategy: null })
    );
    mockGetContainerStatus.mockResolvedValue({ status_code: "FINISHED" });

    await publishPost("post_1");

    expect(mockCreateMediaContainer).toHaveBeenCalledWith(
      "token",
      "ig_1",
      expect.objectContaining({
        trialReel: { graduationStrategy: "SS_PERFORMANCE" },
      })
    );
  });

  it("does not send trial params for a plain video post", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      imagePost({ mediaType: "VIDEO", isTrialReel: true })
    );
    mockGetContainerStatus.mockResolvedValue({ status_code: "FINISHED" });

    await publishPost("post_1");

    // isTrialReel is REEL-only; a VIDEO row must not smuggle it through.
    expect(mockCreateMediaContainer).toHaveBeenCalledWith(
      "token",
      "ig_1",
      expect.objectContaining({ trialReel: undefined, mediaType: undefined })
    );
  });
});

describe("publishPost — failures", () => {
  beforeEach(() => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });
  });

  it("marks the post failed when the Meta call throws", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(imagePost());
    mockCreateMediaContainer.mockRejectedValue(new Error("Unsupported request"));

    await publishPost("post_1");

    const finalUpdate = mockPrisma.post.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data.status).toBe("FAILED");
    expect(finalUpdate.data.errorMessage).toBe("Unsupported request");
  });

  it("stops quietly when the claimed row disappeared", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(null);

    await expect(publishPost("post_1")).resolves.toBeUndefined();
    expect(mockCreateMediaContainer).not.toHaveBeenCalled();
  });
});
