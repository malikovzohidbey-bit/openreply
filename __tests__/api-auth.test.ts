import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockGetCurrentWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
  mockGetCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: mockGetCurrentWorkspaceId,
}));

import {
  getBearerToken,
  resolveWorkspaceId,
  safeEqual,
} from "../lib/api-auth";

const KEY = "a".repeat(64);
const CRON_SECRET = "c".repeat(48);

function requestWith(headers: Record<string, string> = {}) {
  return new Request("http://x/api/posts", { headers });
}

function bearer(token: string, scheme = "Bearer") {
  return requestWith({ authorization: `${scheme} ${token}` });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // clearAllMocks keeps mockResolvedValue implementations, which would leak
  // a session or workspace from one case into the next.
  mockGetCurrentWorkspaceId.mockReset();
  mockPrisma.workspace.findUnique.mockReset();
  // Pin the secrets the key must differ from so a developer's local env
  // cannot change the outcome.
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(48));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveWorkspaceId with a bearer key", () => {
  it("resolves a valid key to API_WORKSPACE_ID without touching the session", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockPrisma.workspace.findUnique.mockResolvedValue({ id: "ws_api" });

    await expect(resolveWorkspaceId(bearer(KEY))).resolves.toBe("ws_api");

    expect(mockGetCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "ws_api" },
      select: { id: true },
    });
  });

  it("fails closed on a wrong key, with no session fallback", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockGetCurrentWorkspaceId.mockResolvedValue("ws_session");

    await expect(resolveWorkspaceId(bearer("b".repeat(64)))).resolves.toBeNull();

    expect(mockGetCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it("accepts a lowercase bearer scheme", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockPrisma.workspace.findUnique.mockResolvedValue({ id: "ws_api" });

    await expect(resolveWorkspaceId(bearer(KEY, "bearer"))).resolves.toBe(
      "ws_api"
    );
  });

  it("returns null when API_WORKSPACE_ID is unset", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);

    await expect(resolveWorkspaceId(bearer(KEY))).resolves.toBeNull();

    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(mockGetCurrentWorkspaceId).not.toHaveBeenCalled();
  });

  it("returns null when the workspace does not exist", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);
    vi.stubEnv("API_WORKSPACE_ID", "ws_gone");
    mockPrisma.workspace.findUnique.mockResolvedValue(null);

    await expect(resolveWorkspaceId(bearer(KEY))).resolves.toBeNull();

    expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentWorkspaceId).not.toHaveBeenCalled();
  });
});

describe("resolveWorkspaceId with a session", () => {
  it("uses the session workspace when there is no authorization header", async () => {
    mockGetCurrentWorkspaceId.mockResolvedValue("ws_session");

    await expect(resolveWorkspaceId(requestWith())).resolves.toBe("ws_session");

    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when there is no header and no session", async () => {
    mockGetCurrentWorkspaceId.mockResolvedValue(null);

    await expect(resolveWorkspaceId(requestWith())).resolves.toBeNull();
  });

  it("keeps using the session when a key is configured but no bearer is sent", async () => {
    vi.stubEnv("POSTS_API_KEY", KEY);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockGetCurrentWorkspaceId.mockResolvedValue("ws_session");

    await expect(resolveWorkspaceId(requestWith())).resolves.toBe("ws_session");

    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it("falls through to the session when POSTS_API_KEY is unset", async () => {
    mockGetCurrentWorkspaceId.mockResolvedValue(null);

    await expect(resolveWorkspaceId(bearer(KEY))).resolves.toBeNull();
    expect(mockGetCurrentWorkspaceId).toHaveBeenCalledTimes(1);

    mockGetCurrentWorkspaceId.mockResolvedValue("ws_session");
    await expect(resolveWorkspaceId(bearer(KEY))).resolves.toBe("ws_session");
  });

  it("disables key auth for a key shorter than 32 characters", async () => {
    const short = "s".repeat(31);
    vi.stubEnv("POSTS_API_KEY", short);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockGetCurrentWorkspaceId.mockResolvedValue(null);

    await expect(resolveWorkspaceId(bearer(short))).resolves.toBeNull();

    expect(mockGetCurrentWorkspaceId).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it("disables key auth when the key equals CRON_SECRET", async () => {
    vi.stubEnv("POSTS_API_KEY", CRON_SECRET);
    vi.stubEnv("API_WORKSPACE_ID", "ws_api");
    mockGetCurrentWorkspaceId.mockResolvedValue(null);

    await expect(resolveWorkspaceId(bearer(CRON_SECRET))).resolves.toBeNull();

    expect(mockGetCurrentWorkspaceId).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workspace.findUnique).not.toHaveBeenCalled();
  });
});

describe("getBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(getBearerToken(bearer("abc123"))).toBe("abc123");
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(getBearerToken(requestWith({ authorization: "Basic xyz" }))).toBeNull();
  });

  it("returns null for an empty or missing header", () => {
    expect(getBearerToken(requestWith({ authorization: "" }))).toBeNull();
    expect(getBearerToken(requestWith())).toBeNull();
  });
});

describe("safeEqual", () => {
  it("compares strings of different lengths without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });
});
