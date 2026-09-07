/**
 * Calendar grid for the avtopost view.
 *
 * The grid always renders whole Monday-start weeks, so a month view spills a
 * few days into the neighbouring months. Those cells are real — a post can sit
 * on one — so the same range that is drawn is the range that gets fetched.
 */

export type CalendarView = "month" | "week";

/** Monday-start week containing `date`, at midnight local time. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Every day cell the grid shows, in order. 7 for a week, 28-42 for a month. */
export function buildCalendarDays(view: CalendarView, cursor: Date): Date[] {
  const result: Date[] = [];

  if (view === "week") {
    const d = startOfWeek(cursor);
    for (let i = 0; i < 7; i++) {
      result.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return result;
  }

  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const d = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  // Keep going until the month is covered and the final week is complete.
  // The 42 ceiling is six weeks — the most any month can span.
  while ((d < monthEnd || result.length % 7 !== 0) && result.length < 42) {
    result.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return result;
}

/**
 * Fetch window for a set of day cells: from the first cell to the end of the
 * last one. Drawn days and fetched days have to match, otherwise posts on the
 * padding days of a month view would silently have no dot.
 */
export function rangeForDays(days: Date[]): { start: Date; end: Date } {
  const start = new Date(days[0] ?? new Date());
  const end = new Date(days[days.length - 1] ?? new Date());
  end.setDate(end.getDate() + 1); // exclusive upper bound
  return { start, end };
}
