import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getApiWorkspaceId,
  getEncryptionKeyHex,
  getMetaGraphApiVersion,
  getPostsApiKey,
  isEmailAllowedToSignIn,
  requireEnv,
} from "../lib/env";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("environment helpers", () => {
  it("requires missing variables", () => {
    expect(() => requireEnv("MISSING_TEST_ENV")).toThrow(
      "MISSING_TEST_ENV environment variable is required"
    );
  });

  it("validates the encryption key format", () => {
    vi.stubEnv("ENCRYPTION_KEY", "not-hex");
    expect(() => getEncryptionKeyHex()).toThrow(
      "ENCRYPTION_KEY must be a 32-byte hex string"
    );
  });

  it("defaults Meta Graph API version in one place", () => {
    expect(getMetaGraphApiVersion()).toBe("v25.0");
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    expect(getMetaGraphApiVersion()).toBe("v26.0");
  });
});

describe("sign-in allowlist", () => {
  it("allows everyone when ALLOWED_EMAILS is unset", () => {
    expect(isEmailAllowedToSignIn("anyone@example.com")).toBe(true);
  });

  it("allows everyone when ALLOWED_EMAILS is empty or only separators", () => {
    vi.stubEnv("ALLOWED_EMAILS", "  , ,  ");
    expect(isEmailAllowedToSignIn("anyone@example.com")).toBe(true);
  });

  it("only allows listed addresses once ALLOWED_EMAILS is set", () => {
    vi.stubEnv("ALLOWED_EMAILS", "owner@example.com,team@example.com");
    expect(isEmailAllowedToSignIn("owner@example.com")).toBe(true);
    expect(isEmailAllowedToSignIn("team@example.com")).toBe(true);
    expect(isEmailAllowedToSignIn("stranger@example.com")).toBe(false);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    vi.stubEnv("ALLOWED_EMAILS", "  Owner@Example.com , team@example.com ");
    expect(isEmailAllowedToSignIn("OWNER@example.COM")).toBe(true);
  });

  it("rejects a missing address when the list is set", () => {
    vi.stubEnv("ALLOWED_EMAILS", "owner@example.com");
    expect(isEmailAllowedToSignIn(null)).toBe(false);
    expect(isEmailAllowedToSignIn(undefined)).toBe(false);
    expect(isEmailAllowedToSignIn("")).toBe(false);
  });
});

describe("posts API key", () => {
  const VALID_KEY = "0123456789abcdef".repeat(4);

  beforeEach(() => {
    // Fresh spy per case so the call counts below do not accumulate.
    vi.restoreAllMocks();
    vi.stubEnv("CRON_SECRET", "c".repeat(48));
    vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(48));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is null when POSTS_API_KEY is unset", () => {
    vi.stubEnv("POSTS_API_KEY", "");
    expect(getPostsApiKey()).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("is null when the key is shorter than 32 characters", () => {
    vi.stubEnv("POSTS_API_KEY", "x".repeat(31));
    expect(getPostsApiKey()).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("is null when the key equals CRON_SECRET", () => {
    vi.stubEnv("POSTS_API_KEY", "c".repeat(48));
    expect(getPostsApiKey()).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("is null when the key equals NEXTAUTH_SECRET", () => {
    vi.stubEnv("POSTS_API_KEY", "n".repeat(48));
    expect(getPostsApiKey()).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns a valid 64-hex key, trimmed", () => {
    vi.stubEnv("POSTS_API_KEY", `  ${VALID_KEY}\n`);
    expect(getPostsApiKey()).toBe(VALID_KEY);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reads API_WORKSPACE_ID, null when unset or blank, trimmed otherwise", () => {
    vi.stubEnv("API_WORKSPACE_ID", "");
    expect(getApiWorkspaceId()).toBeNull();
    vi.stubEnv("API_WORKSPACE_ID", "   ");
    expect(getApiWorkspaceId()).toBeNull();
    vi.stubEnv("API_WORKSPACE_ID", "  ws_123 ");
    expect(getApiWorkspaceId()).toBe("ws_123");
  });
});
