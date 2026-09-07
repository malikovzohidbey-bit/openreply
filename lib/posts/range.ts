/**
 * HTTP Range header parsing for served uploads.
 *
 * Instagram's media fetcher and browser video players both seek with Range
 * requests, and a bad range must not become a 500 — hence the explicit
 * "unsatisfiable" case, which the caller answers with 416.
 */

export type ParsedRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

const RANGE_RE = /bytes=(\d+)-(\d*)/;

export function parseRange(
  rangeHeader: string | null,
  fileSize: number
): ParsedRange {
  if (!rangeHeader) return { kind: "full" };

  const match = RANGE_RE.exec(rangeHeader);
  // Anything we don't understand (including suffix ranges like "bytes=-500")
  // is answered with the whole file, which is a valid response to a Range.
  if (!match) return { kind: "full" };

  const start = parseInt(match[1], 10);
  const end = match[2]
    ? Math.min(parseInt(match[2], 10), fileSize - 1)
    : fileSize - 1;

  if (!Number.isFinite(start) || start >= fileSize || start > end) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "partial", start, end };
}
