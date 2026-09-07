/**
 * Upload Range Requests — Unit Tests
 *
 * Instagram's media fetcher and browser video players seek with Range
 * headers. A range the file can't satisfy has to come back as 416, not as a
 * crash inside createReadStream.
 */

import { describe, it, expect } from "vitest";
import { parseRange } from "../lib/posts/range";

const SIZE = 1000;

describe("parseRange", () => {
  it("serves the whole file when no Range header is sent", () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: "full" });
  });

  it("reads a closed range", () => {
    expect(parseRange("bytes=0-499", SIZE)).toEqual({
      kind: "partial",
      start: 0,
      end: 499,
    });
  });

  it("runs an open-ended range to the last byte", () => {
    expect(parseRange("bytes=500-", SIZE)).toEqual({
      kind: "partial",
      start: 500,
      end: 999,
    });
  });

  it("clamps an end past the file to the last byte", () => {
    // Players routinely ask for more than exists; that is not an error.
    expect(parseRange("bytes=900-99999", SIZE)).toEqual({
      kind: "partial",
      start: 900,
      end: 999,
    });
  });

  it("reports a start past the end of the file as unsatisfiable", () => {
    // Previously this reached createReadStream with start > end and threw,
    // turning a seek into a 500.
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-6000", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports a reversed range as unsatisfiable", () => {
    expect(parseRange("bytes=800-200", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("allows a single-byte range at the very end", () => {
    expect(parseRange("bytes=999-999", SIZE)).toEqual({
      kind: "partial",
      start: 999,
      end: 999,
    });
  });

  it("falls back to the whole file for forms it does not parse", () => {
    // Suffix ranges and junk both get the full body, which is a valid answer.
    expect(parseRange("bytes=-500", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("chunks=1-2", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("", SIZE)).toEqual({ kind: "full" });
  });

  it("treats every range against an empty file as unsatisfiable", () => {
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
