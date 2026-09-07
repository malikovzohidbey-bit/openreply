/**
 * Avtopost Calendar Grid — Unit Tests
 *
 * The grid draws whole Monday-start weeks, so a month view includes days from
 * the months either side. Those cells carry post dots like any other, which
 * only works if the fetch range covers exactly what is drawn.
 */

import { describe, it, expect } from "vitest";
import {
  buildCalendarDays,
  isSameDay,
  rangeForDays,
  startOfWeek,
} from "../lib/posts/calendar";

describe("startOfWeek", () => {
  it("treats Monday as the first day", () => {
    // 9 Sep 2026 is a Wednesday.
    const monday = startOfWeek(new Date(2026, 8, 9, 15, 30));
    expect(monday.getDate()).toBe(7);
    expect(monday.getDay()).toBe(1);
  });

  it("keeps a Monday where it is", () => {
    expect(startOfWeek(new Date(2026, 8, 7)).getDate()).toBe(7);
  });

  it("walks a Sunday back to the Monday before it", () => {
    // 13 Sep 2026 is a Sunday — it belongs to the week starting the 7th.
    expect(startOfWeek(new Date(2026, 8, 13)).getDate()).toBe(7);
  });

  it("zeroes the time so day comparisons are stable", () => {
    const monday = startOfWeek(new Date(2026, 8, 9, 23, 59, 59));
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    expect(monday.getSeconds()).toBe(0);
  });
});

describe("buildCalendarDays — week view", () => {
  it("returns exactly seven consecutive days", () => {
    const days = buildCalendarDays("week", new Date(2026, 8, 9));
    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(7);
    expect(days[6].getDate()).toBe(13);
  });

  it("spans a month boundary", () => {
    // Week of 28 Sep 2026 runs into October.
    const days = buildCalendarDays("week", new Date(2026, 8, 30));
    expect(days[0].getDate()).toBe(28);
    expect(days[0].getMonth()).toBe(8);
    expect(days[6].getDate()).toBe(4);
    expect(days[6].getMonth()).toBe(9);
  });
});

describe("buildCalendarDays — month view", () => {
  it("always returns whole weeks", () => {
    for (const month of [0, 1, 5, 8, 11]) {
      const days = buildCalendarDays("month", new Date(2026, month, 15));
      expect(days.length % 7).toBe(0);
    }
  });

  it("starts on the Monday on or before the 1st", () => {
    // 1 Sep 2026 is a Tuesday, so the grid opens on Monday 31 Aug.
    const days = buildCalendarDays("month", new Date(2026, 8, 15));
    expect(days[0].getMonth()).toBe(7); // August
    expect(days[0].getDate()).toBe(31);
    expect(days[0].getDay()).toBe(1);
  });

  it("covers every day of the month", () => {
    const days = buildCalendarDays("month", new Date(2026, 8, 15));
    const september = days.filter((d) => d.getMonth() === 8);
    expect(september).toHaveLength(30);
    expect(september[0].getDate()).toBe(1);
    expect(september[29].getDate()).toBe(30);
  });

  it("includes the padding days from the next month", () => {
    // 30 Sep 2026 is a Wednesday, so the last week runs to Sunday 4 Oct.
    const days = buildCalendarDays("month", new Date(2026, 8, 15));
    const last = days[days.length - 1];
    expect(last.getMonth()).toBe(9); // October
    expect(last.getDate()).toBe(4);
  });

  it("handles a month that starts on a Monday without leading padding", () => {
    // 1 Jun 2026 is a Monday.
    const days = buildCalendarDays("month", new Date(2026, 5, 15));
    expect(days[0].getDate()).toBe(1);
    expect(days[0].getMonth()).toBe(5);
  });

  it("handles February in a leap year", () => {
    const days = buildCalendarDays("month", new Date(2028, 1, 10));
    const february = days.filter((d) => d.getMonth() === 1);
    expect(february).toHaveLength(29);
  });

  it("never exceeds six weeks", () => {
    for (let month = 0; month < 12; month++) {
      const days = buildCalendarDays("month", new Date(2026, month, 15));
      expect(days.length).toBeLessThanOrEqual(42);
    }
  });
});

describe("rangeForDays", () => {
  it("covers from the first cell to the end of the last one", () => {
    const days = buildCalendarDays("month", new Date(2026, 8, 15));
    const { start, end } = rangeForDays(days);

    expect(isSameDay(start, days[0])).toBe(true);
    // Exclusive upper bound: the day after the final cell.
    expect(end.getDate()).toBe(5);
    expect(end.getMonth()).toBe(9);
  });

  it("includes posts sitting on a month view's padding days", () => {
    // The regression this guards: a post on 31 Aug is drawn in the September
    // grid, so the fetch window has to reach back far enough to return it.
    const days = buildCalendarDays("month", new Date(2026, 8, 15));
    const { start, end } = rangeForDays(days);
    const postOnPaddingDay = new Date(2026, 7, 31, 12, 0);

    expect(postOnPaddingDay >= start).toBe(true);
    expect(postOnPaddingDay < end).toBe(true);
  });

  it("matches the week exactly in week view", () => {
    const days = buildCalendarDays("week", new Date(2026, 8, 9));
    const { start, end } = rangeForDays(days);

    expect(start.getDate()).toBe(7);
    expect(end.getDate()).toBe(14);
  });
});
