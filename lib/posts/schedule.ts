/**
 * Scheduling slots for a batch of composed posts.
 *
 * The composer lets someone queue several pieces of content at once and spread
 * them one per day. This is the pure half of that: given a position in the
 * sequence, work out when that post should go out. Kept out of the component
 * so the date arithmetic is testable on its own.
 */

export interface SlotOptions {
  /** Post the very first item immediately instead of on `startDate`. */
  postFirstNow: boolean;
  /** "YYYY-MM-DD" from a date input. */
  startDate: string;
  /** "HH:mm" from a time input. */
  timeOfDay: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function parseStartDate(startDate: string, now: Date): Date {
  // An empty or malformed date input must not produce an Invalid Date — that
  // would blow up later at toISOString(). Fall back to today instead.
  if (!DATE_RE.test(startDate)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const [y, m, d] = startDate.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime())
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : parsed;
}

function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } {
  const match = TIME_RE.exec(timeOfDay);
  if (!match) return { hours: 12, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { hours: 12, minutes: 0 };
  return { hours, minutes };
}

/**
 * When item `orderIndex` (0-based, across the whole composer session) should
 * publish. `null` means "immediately", which only ever applies to the first
 * item and only when `postFirstNow` is on.
 *
 * With `postFirstNow`, the first item goes out now and the *second* item takes
 * `startDate` itself — the field is labelled "start date", so the schedule has
 * to actually begin there rather than a day later.
 */
export function computeSlot(orderIndex: number, options: SlotOptions): Date | null {
  const now = options.now ?? new Date();
  if (orderIndex === 0 && options.postFirstNow) return null;

  const dayOffset = options.postFirstNow ? orderIndex - 1 : orderIndex;
  const { hours, minutes } = parseTimeOfDay(options.timeOfDay);

  const slot = parseStartDate(options.startDate, now);
  slot.setDate(slot.getDate() + dayOffset);
  slot.setHours(hours, minutes, 0, 0);
  return slot;
}

/** Slots for `count` items starting at `startIndex` in the running sequence. */
export function computeSlots(
  count: number,
  startIndex: number,
  options: SlotOptions
): Array<Date | null> {
  return Array.from({ length: count }, (_, i) =>
    computeSlot(startIndex + i, options)
  );
}
