import {
  getMediaInsights,
  type InstagramMediaInsights,
} from "@/lib/meta/client";
import { METRIC_GROUPS } from "@/lib/insights/cadence";

export type MediaInsightType = "IMAGE" | "VIDEO" | "REEL";

export interface MediaInsightGroupsResult {
  metrics: Partial<InstagramMediaInsights & { reposts?: number }>;
  /** Group name -> error message, for every group that failed. */
  errors: Record<string, string>;
}

/**
 * Fetch every applicable metric group for one media, tolerating failures.
 *
 * Never throws: a group that errors (an unsupported metric, a permission gap)
 * is recorded in `errors` and the other groups still come back. The caller
 * stores both, so a missing number is explained instead of looking like zero.
 */
export async function fetchMediaInsightGroups(
  token: string,
  mediaId: string,
  mediaType: MediaInsightType
): Promise<MediaInsightGroupsResult> {
  const metrics: MediaInsightGroupsResult["metrics"] = {};
  const errors: Record<string, string> = {};

  for (const group of METRIC_GROUPS) {
    if (group.reelOnly && mediaType !== "REEL") continue;

    try {
      const result = await getMediaInsights(token, mediaId, [...group.metrics]);
      Object.assign(metrics, result);
    } catch (err) {
      errors[group.name] = err instanceof Error ? err.message : String(err);
    }
  }

  return { metrics, errors };
}
