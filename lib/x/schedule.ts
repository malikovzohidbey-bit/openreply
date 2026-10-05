/**
 * Random-looking publish slots for a batch of X posts.
 *
 * Pure so it runs in the browser (local time zone) and in tests. Given N
 * posts, a start date, a number of days and a daily time window, spread the
 * posts across the days as evenly as possible and pick a random minute for
 * each, keeping every two slots on the same day at least `minGapMinutes`
 * apart so the account doesn't look like a bot firing in bursts.
 */

export interface RandomSlotOptions {
  count: number;
  /** "YYYY-MM-DD" (local). */
  startDate: string;
  days: number;
  /** "HH:mm" (local). */
  windowStart: string;
  /** "HH:mm" (local), must be after windowStart. */
  windowEnd: string;
  minGapMinutes: number;
  /** Injectable for tests; defaults to now. */
  now?: Date;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

/** Deterministic PRNG (mulberry32) so a distribution stays put until the user
 *  explicitly reshuffles, instead of changing on every re-render. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Slots must land at least this far ahead so the minutely cron can't miss them. */
const LEAD_MINUTES = 3;

function parseDate(value: string, now: Date): Date {
  if (!DATE_RE.test(value)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime())
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : parsed;
}

function parseMinutes(value: string, fallback: number): number {
  const match = TIME_RE.exec(value);
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return fallback;
  return h * 60 + m;
}

function startOfDay(date: Date, offsetDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

export function generateRandomSlots(options: RandomSlotOptions): Date[] {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const count = Math.max(0, Math.floor(options.count));
  const days = Math.max(1, Math.floor(options.days));
  const gap = Math.max(0, Math.floor(options.minGapMinutes));
  if (count === 0) return [];

  const windowStart = parseMinutes(options.windowStart, 9 * 60);
  const windowEnd = parseMinutes(options.windowEnd, 23 * 60);
  if (windowEnd <= windowStart) {
    throw new Error("Oyna tugash vaqti boshlanishidan keyin bo'lishi kerak");
  }

  const firstDay = parseDate(options.startDate, now);
  const earliest = now.getTime() + LEAD_MINUTES * 60_000;

  // Per-day usable range in minutes-from-midnight, after clipping today's
  // window to what is still ahead of us.
  const ranges: Array<{ day: Date; from: number; to: number; capacity: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = startOfDay(firstDay, i);
    let from = windowStart;
    const dayStartMs = day.getTime();
    if (dayStartMs + windowEnd * 60_000 <= earliest) {
      ranges.push({ day, from, to: windowEnd, capacity: 0 });
      continue;
    }
    if (dayStartMs + from * 60_000 < earliest) {
      from = Math.ceil((earliest - dayStartMs) / 60_000);
    }
    const span = windowEnd - from;
    const capacity = span < 0 ? 0 : gap === 0 ? Infinity : Math.floor(span / gap) + 1;
    ranges.push({ day, from, to: windowEnd, capacity });
  }

  const totalCapacity = ranges.reduce((sum, r) => sum + r.capacity, 0);
  if (totalCapacity < count) {
    throw new Error(
      `Bu oynaga ${count} ta post sig'maydi (maksimum ${totalCapacity === Infinity ? "cheksiz" : totalCapacity}). Kunlar sonini oshiring yoki oraliqni kamaytiring.`
    );
  }

  // Even split first, then hand the remainder to random days that still have room.
  const quotas = ranges.map((r) => Math.min(r.capacity, Math.floor(count / days)));
  let remaining = count - quotas.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    const open = ranges
      .map((r, i) => i)
      .filter((i) => quotas[i] < ranges[i].capacity);
    const pick = open[Math.floor(random() * open.length)];
    quotas[pick] += 1;
    remaining -= 1;
  }

  const slots: Date[] = [];
  ranges.forEach((range, i) => {
    const n = quotas[i];
    if (n === 0) return;
    // Compress the range by the gaps, sample uniformly, then re-expand: every
    // consecutive pair ends up ≥ gap apart while staying uniformly random.
    const free = range.to - range.from - (n - 1) * gap;
    const picks = Array.from({ length: n }, () => random() * free).sort((a, b) => a - b);
    picks.forEach((p, j) => {
      const minute = Math.round(range.from + p + j * gap);
      const slot = new Date(range.day);
      slot.setMinutes(minute, 0, 0);
      slots.push(slot);
    });
  });

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Splits pasted text into individual posts. A line of three or more dashes
 * is the explicit separator; without any, blank lines separate posts.
 */
export function splitPosts(raw: string): string[] {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const byDashes = normalized.split(/^\s*-{3,}\s*$/m);
  const chunks =
    byDashes.length > 1 ? byDashes : normalized.split(/\n[ \t]*\n+/);
  return chunks.map((c) => c.trim()).filter(Boolean);
}
