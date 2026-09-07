/**
 * Avtopost Scheduling — Unit Tests
 *
 * Covers the one-per-day slot arithmetic behind the composer's batch upload:
 * which calendar day and time each queued post lands on, and how the
 * "post the first one now" option shifts the rest of the sequence.
 */

import { describe, it, expect } from "vitest";
import { computeSlot, computeSlots } from "../lib/posts/schedule";

const NOW = new Date(2026, 8, 7, 9, 30); // 7 Sep 2026, 09:30 local

describe("computeSlot", () => {
  it("gives the first item the start date itself when not posting now", () => {
    const slot = computeSlot(0, {
      postFirstNow: false,
      startDate: "2026-09-10",
      timeOfDay: "18:45",
      now: NOW,
    });

    expect(slot).not.toBeNull();
    expect(slot!.getFullYear()).toBe(2026);
    expect(slot!.getMonth()).toBe(8); // September
    expect(slot!.getDate()).toBe(10);
    expect(slot!.getHours()).toBe(18);
    expect(slot!.getMinutes()).toBe(45);
  });

  it("returns null (publish immediately) for the first item when posting now", () => {
    const slot = computeSlot(0, {
      postFirstNow: true,
      startDate: "2026-09-10",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slot).toBeNull();
  });

  it("starts the scheduled run on the start date even when the first went out now", () => {
    // The field is labelled "start date", so the second item — the first one
    // that is actually scheduled — has to land on that date, not a day later.
    const slot = computeSlot(1, {
      postFirstNow: true,
      startDate: "2026-09-10",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slot!.getDate()).toBe(10);
  });

  it("advances one calendar day per position", () => {
    const options = {
      postFirstNow: false,
      startDate: "2026-09-10",
      timeOfDay: "09:00",
      now: NOW,
    };

    expect(computeSlot(0, options)!.getDate()).toBe(10);
    expect(computeSlot(1, options)!.getDate()).toBe(11);
    expect(computeSlot(2, options)!.getDate()).toBe(12);
  });

  it("rolls over into the next month", () => {
    const slot = computeSlot(3, {
      postFirstNow: false,
      startDate: "2026-09-29",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slot!.getMonth()).toBe(9); // October
    expect(slot!.getDate()).toBe(2);
  });

  it("falls back to today when the date input is empty", () => {
    // An empty date input previously produced an Invalid Date, which threw at
    // toISOString() when the upload was assembled.
    const slot = computeSlot(0, {
      postFirstNow: false,
      startDate: "",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slot).not.toBeNull();
    expect(Number.isNaN(slot!.getTime())).toBe(false);
    expect(slot!.getDate()).toBe(7);
    expect(slot!.getMonth()).toBe(8);
  });

  it("falls back to today when the date input is malformed", () => {
    const slot = computeSlot(0, {
      postFirstNow: false,
      startDate: "not-a-date",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(Number.isNaN(slot!.getTime())).toBe(false);
    expect(slot!.getDate()).toBe(7);
  });

  it("falls back to midday when the time input is unusable", () => {
    for (const timeOfDay of ["", "99:99", "abc"]) {
      const slot = computeSlot(0, {
        postFirstNow: false,
        startDate: "2026-09-10",
        timeOfDay,
        now: NOW,
      });

      expect(slot!.getHours()).toBe(12);
      expect(slot!.getMinutes()).toBe(0);
    }
  });

  it("zeroes seconds so slots land exactly on the chosen minute", () => {
    const slot = computeSlot(0, {
      postFirstNow: false,
      startDate: "2026-09-10",
      timeOfDay: "07:05",
      now: NOW,
    });

    expect(slot!.getSeconds()).toBe(0);
    expect(slot!.getMilliseconds()).toBe(0);
  });
});

describe("computeSlots", () => {
  it("spreads a batch one per day after an immediate first post", () => {
    const slots = computeSlots(4, 0, {
      postFirstNow: true,
      startDate: "2026-09-10",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slots[0]).toBeNull();
    expect(slots[1]!.getDate()).toBe(10);
    expect(slots[2]!.getDate()).toBe(11);
    expect(slots[3]!.getDate()).toBe(12);
  });

  it("continues the sequence for items added after an earlier batch", () => {
    // Two already queued, then two more added later: they slot in after the
    // ones already scheduled rather than restarting at the start date.
    const slots = computeSlots(2, 2, {
      postFirstNow: false,
      startDate: "2026-09-10",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slots[0]!.getDate()).toBe(12);
    expect(slots[1]!.getDate()).toBe(13);
  });

  it("never returns an immediate slot for a continuation batch", () => {
    const slots = computeSlots(2, 1, {
      postFirstNow: true,
      startDate: "2026-09-10",
      timeOfDay: "12:00",
      now: NOW,
    });

    expect(slots.every((s) => s !== null)).toBe(true);
  });
});
