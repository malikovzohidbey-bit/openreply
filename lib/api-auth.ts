import { createHash, timingSafeEqual } from "crypto";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getApiWorkspaceId, getPostsApiKey } from "@/lib/env";

/**
 * Workspace resolution for API routes that an external script may call.
 *
 * The posting API normally needs a browser session, which a headless script
 * cannot get through the magic-link flow. POSTS_API_KEY is a static bearer key
 * that stands in for the session and acts on the single workspace named by
 * API_WORKSPACE_ID. Blast radius: whoever holds the key can create, list and
 * delete posts on every Instagram account connected to that workspace, so keep
 * it out of git and rotate it like any other credential.
 *
 * This lives outside lib/auth.ts on purpose: that file builds NextAuth at
 * import time, which a plain helper (and its tests) should not drag in.
 */

// Hashing first gives timingSafeEqual equal-length buffers whatever the input,
// so neither the key's length nor its content leaks through timing.
const digest = (v: string) => createHash("sha256").update(v).digest();

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function getBearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

/**
 * Bearer key -> API_WORKSPACE_ID (validated); no bearer -> session.
 * A wrong key fails closed: it never falls back to the session.
 */
export async function resolveWorkspaceId(req: Request): Promise<string | null> {
  const token = getBearerToken(req);
  const key = getPostsApiKey();

  if (token && key) {
    if (!safeEqual(token, key)) return null;

    const id = getApiWorkspaceId();
    if (!id) {
      console.error(
        "[api-auth] POSTS_API_KEY is set but API_WORKSPACE_ID is missing"
      );
      return null;
    }

    const ws = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true },
    });
    return ws?.id ?? null;
  }

  return getCurrentWorkspaceId();
}
