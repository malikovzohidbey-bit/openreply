import { describe, expect, it } from "vitest";
import { generateRandomSlots, seededRandom as seeded, splitPosts } from "@/lib/x/schedule";

const NOW = new Date(2026, 8, 13, 8, 0, 0); // Sep 13 2026 08:00 local

describe("generateRandomSlots", () => {
  it("returns exactly count slots, sorted, inside the window", () => {
    const slots = generateRandomSlots({
      count: 12,
      startDate: "2026-09-14",
      days: 7,
      windowStart: "14:00",
      windowEnd: "23:00",
      minGapMinutes: 60,
      now: NOW,
      random: seeded(1),
    });
    expect(slots).toHaveLength(12);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime()).toBeGreaterThanOrEqual(slots[i - 1].getTime());
    }
    for (const slot of slots) {
      const minutes = slot.getHours() * 60 + slot.getMinutes();
      expect(minutes).toBeGreaterThanOrEqual(14 * 60);
      expect(minutes).toBeLessThanOrEqual(23 * 60);
      expect(slot.getSeconds()).toBe(0);
    }
  });

  it("spreads posts evenly across days", () => {
    const slots = generateRandomSlots({
      count: 14,
      startDate: "2026-09-14",
      days: 7,
      windowStart: "09:00",
      windowEnd: "23:00",
      minGapMinutes: 30,
      now: NOW,
      random: seeded(7),
    });
    const perDay = new Map<string, number>();
    for (const s of slots) {
      const key = s.toDateString();
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    expect(perDay.size).toBe(7);
    for (const n of perDay.values()) expect(n).toBe(2);
  });

  it("keeps same-day slots at least minGap apart", () => {
    const slots = generateRandomSlots({
      count: 5,
      startDate: "2026-09-14",
      days: 1,
      windowStart: "10:00",
      windowEnd: "20:00",
      minGapMinutes: 90,
      now: NOW,
      random: seeded(3),
    });
    for (let i = 1; i < slots.length; i++) {
      const diff = (slots[i].getTime() - slots[i - 1].getTime()) / 60_000;
      expect(diff).toBeGreaterThanOrEqual(90);
    }
  });

  it("never schedules in the past when starting today", () => {
    const now = new Date(2026, 8, 13, 21, 30, 0);
    const slots = generateRandomSlots({
      count: 1,
      startDate: "2026-09-13",
      days: 1,
      windowStart: "09:00",
      windowEnd: "23:00",
      minGapMinutes: 60,
      now,
      random: () => 0,
    });
    expect(slots[0].getTime()).toBeGreaterThan(now.getTime());
  });

  it("is deterministic for the same seed and differs for another", () => {
    const opts = {
      count: 6,
      startDate: "2026-09-14",
      days: 3,
      windowStart: "09:00",
      windowEnd: "23:00",
      minGapMinutes: 30,
      now: NOW,
    };
    const a = generateRandomSlots({ ...opts, random: seeded(42) }).map((d) => d.getTime());
    const b = generateRandomSlots({ ...opts, random: seeded(42) }).map((d) => d.getTime());
    const c = generateRandomSlots({ ...opts, random: seeded(43) }).map((d) => d.getTime());
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("throws when the window cannot fit the posts", () => {
    expect(() =>
      generateRandomSlots({
        count: 10,
        startDate: "2026-09-14",
        days: 1,
        windowStart: "10:00",
        windowEnd: "12:00",
        minGapMinutes: 60,
        now: NOW,
      })
    ).toThrow(/sig'maydi/);
  });
});

describe("splitPosts", () => {
  it("splits on --- lines", () => {
    expect(splitPosts("one\nstill one\n---\ntwo\n--------\n three ")).toEqual([
      "one\nstill one",
      "two",
      "three",
    ]);
  });

  it("falls back to blank lines", () => {
    expect(splitPosts("a\n\nb\n\n\nc")).toEqual(["a", "b", "c"]);
  });

  it("keeps blank lines inside a post when --- is used", () => {
    expect(splitPosts("a\n\nb\n---\nc")).toEqual(["a\n\nb", "c"]);
  });
});
