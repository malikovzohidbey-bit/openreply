/**
 * /api/jilo/videos routes — Unit Tests (mocked Prisma)
 *
 * What must never break: another workspace's (or a non-Jilo) post leaking out,
 * a verdict computed against the wrong peers, the analyzer's to-do list
 * (needsAnalysis=1) picking the wrong posts, and a malformed analysis write
 * reaching the database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockResolveWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    post: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    mediaInsightSnapshot: {
      findFirst: vi.fn(),
    },
    postAnalysis: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockResolveWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/api-auth", () => ({ resolveWorkspaceId: mockResolveWorkspaceId }));

const listRoute = await import("../app/api/jilo/videos/route");
const detailRoute = await import("../app/api/jilo/videos/[id]/route");
const analysisRoute = await import("../app/api/jilo/videos/[id]/analysis/route");

const NOW = new Date("2026-10-06T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type SnapFields = Partial<{
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reposts: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  skipRatePct: number | null;
  followersCount: number | null;
}>;

interface PostOpts {
  account?: string;
  status?: string;
  /** Hours since publish; null = not published. */
  ageHours?: number | null;
  /** [hours after publish, fields] */
  snaps?: Array<[number, SnapFields]>;
  meta?: unknown;
  caption?: string | null;
  analysis?: {
    verdict: string;
    text: string;
    model: string | null;
    basedOnSnapshotId: string | null;
    generatedAt: Date;
  } | null;
}

function post(id: string, opts: PostOpts = {}) {
  const ageHours = opts.ageHours === undefined ? 5 * 24 : opts.ageHours;
  const publishedAt =
    ageHours === null ? null : new Date(NOW.getTime() - ageHours * HOUR);
  const account = opts.account ?? "acc_1";
  return {
    id,
    status: opts.status ?? (publishedAt ? "PUBLISHED" : "SCHEDULED"),
    mediaType: "REEL",
    caption: opts.caption === undefined ? `${id} caption\nsecond line` : opts.caption,
    scheduledAt: publishedAt ?? new Date(NOW.getTime() + 2 * HOUR),
    publishedAt,
    errorMessage: null,
    permalink: publishedAt ? `https://instagram.com/reel/${id}/` : null,
    thumbnailUrl: null,
    meta: "meta" in opts ? opts.meta : { title: `Title ${id}`, durationSec: 20 },
    instagramAccountId: account,
    instagramAccount: { username: account === "acc_1" ? "jilo_uz" : "other_uz" },
    insightSnapshots: (opts.snaps ?? []).map(([h, fields], i) => ({
      id: `${id}_s${i}`,
      capturedAt: new Date((publishedAt ?? NOW).getTime() + h * HOUR),
      views: null,
      reach: null,
      likes: null,
      comments: null,
      saved: null,
      shares: null,
      reposts: null,
      totalInteractions: null,
      avgWatchTimeMs: null,
      totalWatchTimeMs: null,
      skipRatePct: null,
      followersCount: null,
      ...fields,
    })),
    analysis: opts.analysis ?? null,
  };
}

/** Published 5 days ago with a capture at 24h and a later one at 100h. */
function publishedWith24h(id: string, views24h: number, account = "acc_1") {
  return post(id, {
    account,
    snaps: [
      [24, { views: views24h }],
      [100, { views: views24h * 3 }],
    ],
  });
}

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? {
          body: typeof init.body === "string" ? init.body : JSON.stringify(init.body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.clearAllMocks();
  mockResolveWorkspaceId.mockReset();
  mockPrisma.post.findMany.mockReset();
  mockPrisma.post.findFirst.mockReset();
  mockPrisma.mediaInsightSnapshot.findFirst.mockReset();
  mockPrisma.postAnalysis.upsert.mockReset();
  mockPrisma.postAnalysis.deleteMany.mockReset();

  mockResolveWorkspaceId.mockResolvedValue("ws_1");
  mockPrisma.post.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function list(query = "") {
  const res = await listRoute.GET(req(`/api/jilo/videos${query}`));
  return { res, json: await res.json() };
}

// ---------------------------------------------------------------------------
// GET /api/jilo/videos
// ---------------------------------------------------------------------------

describe("GET /api/jilo/videos — auth & filters", () => {
  it("401 without a workspace, and never queries", async () => {
    mockResolveWorkspaceId.mockResolvedValue(null);
    const { res, json } = await list();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  it("scopes to the workspace and source=jilo, over the peer window plus the queue", async () => {
    await list();
    const args = mockPrisma.post.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe("ws_1");
    expect(args.where.source).toBe("jilo");
    expect(args.where.instagramAccountId).toBeUndefined();

    const [byDate, byStatus] = args.where.OR;
    // Default 90 days shown, but peers are loaded over 180.
    expect(byDate.publishedAt.gte.getTime()).toBe(NOW.getTime() - 180 * DAY);
    expect(byStatus.status.in).toEqual(["SCHEDULED", "PUBLISHING", "FAILED"]);

    expect(args.include.insightSnapshots.orderBy).toEqual({ capturedAt: "asc" });
    expect(args.include.analysis).toBe(true);
  });

  it("filters by accountId, and treats accountId=all as no filter", async () => {
    await list("?accountId=acc_9");
    expect(mockPrisma.post.findMany.mock.calls[0][0].where.instagramAccountId).toBe("acc_9");

    await list("?accountId=all");
    expect(mockPrisma.post.findMany.mock.calls[1][0].where.instagramAccountId).toBeUndefined();
  });

  it("widens the query when days exceeds the peer window", async () => {
    await list("?days=365");
    const { OR } = mockPrisma.post.findMany.mock.calls[0][0].where;
    expect(OR[0].publishedAt.gte.getTime()).toBe(NOW.getTime() - 365 * DAY);
  });

  it("returns the note and an empty list when there are no jilo posts", async () => {
    const { res, json } = await list();
    expect(res.status).toBe(200);
    expect(json.data.videos).toEqual([]);
    expect(json.data.totals.videos).toBe(0);
    expect(json.data.note).toMatch(/Sekundma-sekund retention/);
  });
});

describe("GET /api/jilo/videos — verdict against peers", () => {
  it("compares views at 24h against the same account's other ≥24h published videos", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      publishedWith24h("p1", 1000),
      publishedWith24h("p2", 100),
      publishedWith24h("p3", 120),
      publishedWith24h("p4", 50),
      // Other account: never a peer of acc_1, and alone on its own account.
      publishedWith24h("p5", 10, "acc_2"),
      // 10h old: not judged yet and not a peer.
      post("p6", { ageHours: 10, snaps: [[5, { views: 5000 }]] }),
    ]);

    const { json } = await list();
    const byId = Object.fromEntries(
      json.data.videos.map((v: { id: string }) => [v.id, v])
    );

    expect(byId.p1).toMatchObject({
      verdict: "UCHDI", // 1000 vs median(100,120,50)=100
      verdictBasis: "views24h",
      verdictValue: 1000,
      peerMedian: 100,
      peerCount: 3,
      views24h: 1000,
    });
    expect(byId.p2.verdict).toBe("O'RTACHA"); // 100 vs median(1000,120,50)=120
    expect(byId.p4).toMatchObject({ verdict: "UCHMADI", peerMedian: 120 }); // 50 ≤ 60
    expect(byId.p5).toMatchObject({ verdict: "KUTILMOQDA", peerCount: 0 });
    expect(byId.p6).toMatchObject({
      verdict: "KUTILMOQDA",
      verdictBasis: null,
      verdictValue: null,
    });
  });

  it("falls back to latest views when there is no value at 24h — and says so", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      publishedWith24h("p1", 100),
      publishedWith24h("p2", 100),
      publishedWith24h("p3", 100),
      // Tracking began late: first capture at 100h.
      post("late", { snaps: [[100, { views: 300 }]] }),
    ]);

    const { json } = await list();
    const late = json.data.videos.find((v: { id: string }) => v.id === "late");
    expect(late).toMatchObject({
      views24h: null,
      verdictBasis: "latestViews",
      verdictValue: 300,
      verdict: "UCHDI",
    });
  });

  it("hides posts published before the range but still uses them as peers", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      publishedWith24h("p1", 400),
      post("old1", { ageHours: 120 * 24, snaps: [[24, { views: 100 }]] }),
      post("old2", { ageHours: 121 * 24, snaps: [[24, { views: 100 }]] }),
      post("old3", { ageHours: 122 * 24, snaps: [[24, { views: 100 }]] }),
    ]);

    const { json } = await list("?days=90");
    expect(json.data.videos.map((v: { id: string }) => v.id)).toEqual(["p1"]);
    expect(json.data.videos[0]).toMatchObject({ verdict: "UCHDI", peerCount: 3 });
  });

  it("keeps the queue (scheduled / failed) visible, newest first", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      publishedWith24h("pub", 100),
      post("sched", { ageHours: null }),
      { ...post("fail", { ageHours: null, status: "FAILED" }), errorMessage: "boom" },
    ]);

    const { json } = await list();
    const ids = json.data.videos.map((v: { id: string }) => v.id);
    expect(ids).toContain("sched");
    expect(ids).toContain("fail");
    expect(ids[ids.length - 1]).toBe("pub");
    const sched = json.data.videos.find((v: { id: string }) => v.id === "sched");
    expect(sched).toMatchObject({ verdict: "KUTILMOQDA", latest: null, needsAnalysis: false });
  });
});

describe("GET /api/jilo/videos — row shape & totals", () => {
  it("surfaces meta fields, the latest snapshot and derived metrics", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post("p1", {
        meta: {
          title: "Hook sinovi",
          jobTitle: "Podcast #12",
          durationSec: 20,
          hookSec: 1.5,
          hookSource: "gemini",
          captionSource: "whisper",
          mappingMode: "auto",
          transcriptExcerpt: "salom...",
        },
        snaps: [
          [1, { views: 10 }],
          [100, { views: 1000, reach: 800, saved: 20, avgWatchTimeMs: 8000, skipRatePct: 30 }],
        ],
      }),
    ]);

    const { json } = await list();
    const v = json.data.videos[0];
    expect(v.title).toBe("Hook sinovi");
    expect(v.meta).toEqual({
      title: "Hook sinovi",
      jobTitle: "Podcast #12",
      job: null,
      rank: null,
      durationSec: 20,
      hookSec: 1.5,
      hookSource: "gemini",
      captionSource: "whisper",
      mappingMode: "auto",
    });
    expect(v.latest).toMatchObject({ id: "p1_s1", views: 1000, reach: 800 });
    expect(v.metrics).toMatchObject({ retentionPct: 40, saveRate: 0.02, viewsPerReach: 1.25 });
    expect(v.accountUsername).toBe("jilo_uz");
    expect(v.snapshotCount).toBe(2);
  });

  it("falls back to the caption's first line for the title", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post("p1", { meta: null, caption: "\n  Birinchi qator \nikkinchi" }),
    ]);
    const { json } = await list();
    expect(json.data.videos[0].title).toBe("Birinchi qator");
  });

  it("computes campaign totals, followers per account summed", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post("a", {
        snaps: [
          [1, { views: 10, followersCount: 5000 }],
          [100, { views: 1000, reach: 900, skipRatePct: 20, avgWatchTimeMs: 10_000, followersCount: 5100 }],
        ],
      }),
      post("b", {
        ageHours: 50,
        snaps: [[40, { views: 3000, reach: 2000, skipRatePct: 40, avgWatchTimeMs: 6000, followersCount: 5200 }]],
      }),
      post("c", {
        account: "acc_2",
        snaps: [
          [2, { views: 5, followersCount: 300 }],
          [90, { views: 200, reach: 100, followersCount: 310 }],
        ],
      }),
      post("q", { ageHours: null }),
      post("f", { ageHours: null, status: "FAILED" }),
    ]);

    const { json } = await list();
    expect(json.data.totals).toEqual({
      videos: 5,
      published: 3,
      scheduled: 1,
      failed: 1,
      views: 4200,
      reach: 3000,
      avgSkipRatePct: 30,
      avgRetentionPct: 40, // (50% + 30%) / 2, c has no watch time
      followersNow: 5510, // acc_1 latest 5200 + acc_2 latest 310
      followersAtCampaignStart: 5300, // acc_1 earliest 5000 + acc_2 earliest 300
      bestPostId: "b",
    });
  });
});

describe("GET /api/jilo/videos?needsAnalysis=1", () => {
  it("returns only posts the analyzer should write, with peer median and transcript", async () => {
    const stale = {
      verdict: "ORTACHA",
      text: "eski",
      model: "m",
      basedOnSnapshotId: "moved_s0",
      generatedAt: new Date(NOW.getTime() - 8 * DAY),
    };
    const fresh = { ...stale, basedOnSnapshotId: "done_s1", generatedAt: new Date(NOW.getTime() - DAY) };

    mockPrisma.post.findMany.mockResolvedValue([
      // No analysis yet → yes.
      post("new", {
        meta: { title: "Yangi", transcriptExcerpt: "salom dunyo" },
        snaps: [[24, { views: 100 }]],
      }),
      // Analysis 8 days old, views 100 → 500 since → yes.
      post("moved", {
        ageHours: 20 * 24,
        snaps: [[24, { views: 100 }], [400, { views: 500 }]],
        analysis: stale,
      }),
      // Fresh analysis → no.
      post("done", { snaps: [[24, { views: 100 }], [100, { views: 900 }]], analysis: fresh }),
      // Too young → no.
      post("young", { ageHours: 5, snaps: [[4, { views: 50 }]] }),
      // Published but never captured → no.
      post("nosnap", {}),
      // Scheduled → no.
      post("queued", { ageHours: null }),
    ]);

    const { json } = await list("?needsAnalysis=1");
    const ids = json.data.videos.map((v: { id: string }) => v.id).sort();
    expect(ids).toEqual(["moved", "new"]);

    const fresh1 = json.data.videos.find((v: { id: string }) => v.id === "new");
    expect(fresh1.meta.transcriptExcerpt).toBe("salom dunyo");
    expect(fresh1).toHaveProperty("peerMedian");
    expect(fresh1.accountUsername).toBe("jilo_uz");
    expect(fresh1.caption).toBe("new caption\nsecond line");
    expect(fresh1.needsAnalysis).toBe(true);
    // Totals still describe the whole campaign, not the to-do list.
    expect(json.data.totals.videos).toBe(6);
  });

  it("without the flag, rows carry needsAnalysis but no transcript", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      post("new", { meta: { transcriptExcerpt: "x" }, snaps: [[24, { views: 1 }]] }),
    ]);
    const { json } = await list();
    expect(json.data.videos[0].needsAnalysis).toBe(true);
    expect(json.data.videos[0].meta).not.toHaveProperty("transcriptExcerpt");
  });
});

// ---------------------------------------------------------------------------
// GET /api/jilo/videos/[id]
// ---------------------------------------------------------------------------

describe("GET /api/jilo/videos/[id]", () => {
  it("401 without a workspace", async () => {
    mockResolveWorkspaceId.mockResolvedValue(null);
    const res = await detailRoute.GET(req("/api/jilo/videos/p1"), ctx("p1"));
    expect(res.status).toBe(401);
    expect(mockPrisma.post.findFirst).not.toHaveBeenCalled();
  });

  it("404 for another workspace's (or a non-jilo) post", async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);
    const res = await detailRoute.GET(req("/api/jilo/videos/foreign"), ctx("foreign"));
    expect(res.status).toBe(404);
    expect(mockPrisma.post.findFirst.mock.calls[0][0].where).toEqual({
      id: "foreign",
      workspaceId: "ws_1",
      source: "jilo",
    });
  });

  it("returns the full growth series, metrics, meta and analysis", async () => {
    mockPrisma.post.findFirst.mockResolvedValue(
      post("p1", {
        meta: { title: "T", durationSec: 10, transcriptExcerpt: "matn" },
        snaps: [
          [1, { views: 10, reach: 8 }],
          [24, { views: 500, reach: 400 }],
          [72, { views: 900, reach: 700, avgWatchTimeMs: 5000 }],
        ],
        analysis: {
          verdict: "UCHDI",
          text: "Hook kuchli",
          model: "claude",
          basedOnSnapshotId: "p1_s2",
          generatedAt: new Date(NOW.getTime() - DAY),
        },
      })
    );

    const res = await detailRoute.GET(req("/api/jilo/videos/p1"), ctx("p1"));
    expect(res.status).toBe(200);
    const { video } = (await res.json()).data;
    expect(video.snapshots.map((s: { views: number }) => s.views)).toEqual([10, 500, 900]);
    expect(typeof video.snapshots[0].capturedAt).toBe("string");
    expect(video.views24h).toBe(500);
    expect(video.views72h).toBe(900);
    expect(video.metrics.retentionPct).toBe(50);
    expect(video.meta.transcriptExcerpt).toBe("matn");
    expect(video.analysis).toMatchObject({ verdict: "UCHDI", text: "Hook kuchli", model: "claude" });
    expect(video.permalink).toBe("https://instagram.com/reel/p1/");
  });
});

// ---------------------------------------------------------------------------
// PUT / DELETE /api/jilo/videos/[id]/analysis
// ---------------------------------------------------------------------------

describe("PUT /api/jilo/videos/[id]/analysis", () => {
  const put = (body: unknown, id = "p1") =>
    analysisRoute.PUT(req(`/api/jilo/videos/${id}/analysis`, { method: "PUT", body }), ctx(id));

  beforeEach(() => {
    mockPrisma.post.findFirst.mockResolvedValue({ id: "p1" });
    mockPrisma.postAnalysis.upsert.mockImplementation(async (args) => ({
      id: "a1",
      ...args.create,
    }));
  });

  it("401 without a workspace", async () => {
    mockResolveWorkspaceId.mockResolvedValue(null);
    const res = await put({ verdict: "UCHDI", text: "x" });
    expect(res.status).toBe(401);
    expect(mockPrisma.postAnalysis.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown verdict", { verdict: "ZO'R", text: "x" }],
    ["the apostrophe form (stored form is ORTACHA)", { verdict: "O'RTACHA", text: "x" }],
    ["missing text", { verdict: "UCHDI" }],
    ["blank text", { verdict: "UCHDI", text: "   " }],
    ["text over 2000 chars", { verdict: "UCHDI", text: "a".repeat(2001) }],
    ["a non-string model", { verdict: "UCHDI", text: "x", model: 5 }],
    ["invalid JSON", "{not json"],
  ])("400 on %s, with no database write", async (_label, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(mockPrisma.postAnalysis.upsert).not.toHaveBeenCalled();
  });

  it("accepts text of exactly 2000 chars", async () => {
    mockPrisma.mediaInsightSnapshot.findFirst.mockResolvedValue({ id: "s_latest" });
    const res = await put({ verdict: "UCHDI", text: "a".repeat(2000) });
    expect(res.status).toBe(200);
  });

  it("404 for another workspace's post", async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);
    const res = await put({ verdict: "UCHDI", text: "x" }, "foreign");
    expect(res.status).toBe(404);
    expect(mockPrisma.post.findFirst.mock.calls[0][0].where).toEqual({
      id: "foreign",
      workspaceId: "ws_1",
      source: "jilo",
    });
    expect(mockPrisma.postAnalysis.upsert).not.toHaveBeenCalled();
  });

  it("upserts with the given snapshot after checking it belongs to the post", async () => {
    mockPrisma.mediaInsightSnapshot.findFirst.mockResolvedValue({ id: "s_7" });
    const res = await put({
      verdict: "ORTACHA",
      text: "  Hook sust, lekin saqlashlar yaxshi  ",
      model: "claude-x",
      basedOnSnapshotId: "s_7",
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.mediaInsightSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: "s_7", postId: "p1" },
      select: { id: true },
    });
    const args = mockPrisma.postAnalysis.upsert.mock.calls[0][0];
    const fields = {
      verdict: "ORTACHA",
      text: "Hook sust, lekin saqlashlar yaxshi",
      model: "claude-x",
      basedOnSnapshotId: "s_7",
    };
    expect(args.where).toEqual({ postId: "p1" });
    expect(args.create).toEqual({ postId: "p1", ...fields });
    expect(args.update).toMatchObject(fields);
    // A rewrite restarts the 7-day clock.
    expect(args.update.generatedAt).toEqual(NOW);
  });

  it("400 when basedOnSnapshotId is not one of this post's snapshots", async () => {
    mockPrisma.mediaInsightSnapshot.findFirst.mockResolvedValue(null);
    const res = await put({ verdict: "UCHDI", text: "x", basedOnSnapshotId: "s_other" });
    expect(res.status).toBe(400);
    expect(mockPrisma.postAnalysis.upsert).not.toHaveBeenCalled();
  });

  it("records the latest snapshot when basedOnSnapshotId is omitted", async () => {
    mockPrisma.mediaInsightSnapshot.findFirst.mockResolvedValue({ id: "s_latest" });
    await put({ verdict: "UCHMADI", text: "Skip rate 70%" });

    expect(mockPrisma.mediaInsightSnapshot.findFirst).toHaveBeenCalledWith({
      where: { postId: "p1" },
      orderBy: { capturedAt: "desc" },
      select: { id: true },
    });
    const args = mockPrisma.postAnalysis.upsert.mock.calls[0][0];
    expect(args.create).toEqual({
      postId: "p1",
      verdict: "UCHMADI",
      text: "Skip rate 70%",
      model: null,
      basedOnSnapshotId: "s_latest",
    });
  });
});

describe("DELETE /api/jilo/videos/[id]/analysis", () => {
  const del = (id = "p1") =>
    analysisRoute.DELETE(req(`/api/jilo/videos/${id}/analysis`, { method: "DELETE" }), ctx(id));

  it("401 without a workspace", async () => {
    mockResolveWorkspaceId.mockResolvedValue(null);
    const res = await del();
    expect(res.status).toBe(401);
    expect(mockPrisma.postAnalysis.deleteMany).not.toHaveBeenCalled();
  });

  it("404 for another workspace's post, deleting nothing", async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);
    const res = await del("foreign");
    expect(res.status).toBe(404);
    expect(mockPrisma.postAnalysis.deleteMany).not.toHaveBeenCalled();
  });

  it("removes only this post's analysis", async () => {
    mockPrisma.post.findFirst.mockResolvedValue({ id: "p1" });
    mockPrisma.postAnalysis.deleteMany.mockResolvedValue({ count: 1 });
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { deleted: 1 } });
    expect(mockPrisma.post.findFirst.mock.calls[0][0].where).toEqual({
      id: "p1",
      workspaceId: "ws_1",
      source: "jilo",
    });
    expect(mockPrisma.postAnalysis.deleteMany).toHaveBeenCalledWith({
      where: { postId: "p1" },
    });
  });
});
