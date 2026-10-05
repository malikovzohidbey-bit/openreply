"use client";

/**
 * X — content calendar
 *
 * Same month/week grid as Avtopost, one dot per post. "Yangi post" takes one
 * or many posts (separated by `---`): either publish a single one right now,
 * or open the scheduling panel and spread the batch over random minutes
 * inside a daily window. The minutely cron publishes them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  buildCalendarDays,
  isSameDay,
  rangeForDays,
} from "@/lib/posts/calendar";
import { generateRandomSlots, seededRandom, splitPosts } from "@/lib/x/schedule";

type XPostStatus = "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

interface XPostRow {
  id: string;
  text: string;
  mediaPath: string | null;
  status: XPostStatus;
  scheduledAt: string;
  publishedAt: string | null;
  tweetId: string | null;
  errorMessage: string | null;
}

const STATUS_COLOR: Record<XPostStatus, string> = {
  SCHEDULED: "bg-amber-400",
  PUBLISHING: "bg-blue-400",
  PUBLISHED: "bg-green-500",
  FAILED: "bg-red-500",
};

const STATUS_LABEL: Record<XPostStatus, string> = {
  SCHEDULED: "Rejalashtirilgan",
  PUBLISHING: "Joylanmoqda...",
  PUBLISHED: "Chop etildi",
  FAILED: "Xato",
};

const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const WEEKDAYS_BY_GETDAY = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const MONTHS = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
];
const MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const X_CHAR_LIMIT = 280;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDayLong(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "Du 14 sen · 16:42" */
function fmtShort(d: Date) {
  return `${WEEKDAYS_BY_GETDAY[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${fmtTime(d)}`;
}
function tweetUrl(id: string) {
  return `https://x.com/i/status/${id}`;
}

const BTN_PRIMARY = "rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white";
const BTN_SECONDARY =
  "rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-hover";
const BTN_DISABLED =
  "rounded-xl border border-border px-4 py-2 text-sm text-muted/60 cursor-not-allowed";
const INPUT =
  "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/40";

export default function XCalendarPage() {
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [posts, setPosts] = useState<XPostRow[]>([]);
  const [missingEnv, setMissingEnv] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const days = useMemo(() => buildCalendarDays(view, cursor), [view, cursor]);
  const range = useMemo(() => rangeForDays(days), [days]);

  const loadPosts = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      const res = await fetch(`/api/x/posts?${params}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: XPostRow[];
        missingEnv?: string[];
        error?: string;
      };
      if (!json.success) throw new Error(json.error ?? "Yuklashda xato");
      setPosts(json.data ?? []);
      setMissingEnv(json.missingEnv ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yuklashda xato");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  // Only poll while something is actually mid-flight; scheduled rows sit
  // still until their minute comes and the cron result shows up on reload.
  useEffect(() => {
    if (!posts.some((p) => p.status === "PUBLISHING")) return;
    const interval = setInterval(() => void loadPosts(), 5000);
    return () => clearInterval(interval);
  }, [posts, loadPosts]);

  function postsOnDay(day: Date): XPostRow[] {
    return posts
      .filter((p) => isSameDay(new Date(p.scheduledAt), day))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  function shiftCursor(direction: 1 | -1) {
    const next = new Date(cursor);
    if (view === "week") next.setDate(next.getDate() + 7 * direction);
    else next.setMonth(next.getMonth() + direction);
    setCursor(next);
  }

  const title = useMemo(() => {
    if (view === "month") return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const start = range.start;
    const end = new Date(range.end);
    end.setDate(end.getDate() - 1);
    return `${start.getDate()} ${MONTHS[start.getMonth()]} — ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  }, [view, cursor, range]);

  async function publishNow(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/x/posts/${id}/publish`, { method: "POST" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? "Yuborishda xato");
      await loadPosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yuborishda xato");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu post o'chirilsinmi?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/x/posts/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? "O'chirishda xato");
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "O'chirishda xato");
    } finally {
      setBusyId(null);
    }
  }

  const selectedPosts = postsOnDay(selectedDay);
  const nowIso = new Date().toISOString();
  const upcoming = posts
    .filter((p) => p.status === "SCHEDULED" && p.scheduledAt >= nowIso)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5);
  const inRangeScheduled = posts.filter((p) => p.status === "SCHEDULED").length;
  const inRangePublished = posts.filter((p) => p.status === "PUBLISHED").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">X kalendari</h1>
        <button onClick={() => setComposerOpen(true)} className={BTN_PRIMARY}>
          + Yangi post
        </button>
      </div>

      {missingEnv.length > 0 && (
        <p className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          X API kalitlari hali kiritilmagan ({missingEnv.join(", ")}). Postlarni
          rejalashtirish mumkin, lekin vaqti kelganda ular &quot;Xato&quot; holatiga
          tushadi — kalitlar <code>.env</code> ga qo&apos;shilgach ishlaydi.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>
      )}
      {notice && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </p>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftCursor(-1)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            ←
          </button>
          <span className="min-w-40 text-center text-sm font-medium text-foreground">{title}</span>
          <button
            onClick={() => shiftCursor(1)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            →
          </button>
          <button
            onClick={() => {
              setCursor(new Date());
              setSelectedDay(new Date());
            }}
            className="ml-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-hover"
          >
            Bugun
          </button>
        </div>

        <div className="flex rounded-lg border border-border p-0.5 text-sm">
          <button
            onClick={() => setView("month")}
            className={`rounded-md px-3 py-1 ${view === "month" ? "bg-surface-hover font-medium text-foreground" : "text-muted"}`}
          >
            Oylik
          </button>
          <button
            onClick={() => setView("week")}
            className={`rounded-md px-3 py-1 ${view === "week" ? "bg-surface-hover font-medium text-foreground" : "text-muted"}`}
          >
            Haftalik
          </button>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted">
        {view === "week" ? "Bu hafta" : "Bu oy"}:{" "}
        <span className="font-medium text-foreground">{inRangeScheduled} ta navbatda</span> ·{" "}
        <span className="font-medium text-foreground">{inRangePublished} ta chop etildi</span>
      </p>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = view === "week" || day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, new Date());
          const isSelected = isSameDay(day, selectedDay);
          const dayPosts = postsOnDay(day);

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDay(day)}
              className={`
                flex flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors
                ${view === "week" ? "min-h-32" : "min-h-20"}
                ${inMonth ? "border-border bg-surface" : "border-border/50 bg-surface/50 opacity-50"}
                ${isToday ? "ring-2 ring-accent/50" : ""}
                ${isSelected ? "border-accent" : "hover:border-accent/40"}
              `}
            >
              <span className={`text-xs ${isToday ? "font-semibold text-accent" : "text-muted"}`}>
                {day.getDate()}
              </span>
              <div className="flex flex-wrap gap-1">
                {dayPosts.map((p) => (
                  <span
                    key={p.id}
                    title={`${fmtTime(new Date(p.scheduledAt))} · ${STATUS_LABEL[p.status]}`}
                    className={`h-3 w-3 rounded-full ${STATUS_COLOR[p.status]}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
        {(Object.keys(STATUS_LABEL) as XPostStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[s]}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <section className="mt-8 space-y-3">
        <h2 className="text-sm font-medium text-foreground">{fmtDayLong(selectedDay)}</h2>
        {loading ? (
          <p className="text-sm text-muted">Yuklanmoqda...</p>
        ) : selectedPosts.length === 0 ? (
          <p className="text-sm text-muted">Bu kunga post yo&apos;q.</p>
        ) : (
          <ul className="space-y-2">
            {selectedPosts.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                busy={busyId === p.id}
                onPublish={() => publishNow(p.id)}
                onDelete={() => remove(p.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="mt-8 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Keyingi postlar</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {upcoming.map((p) => {
              const when = new Date(p.scheduledAt);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setCursor(when);
                      setSelectedDay(when);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
                  >
                    <span className="w-28 shrink-0 text-xs text-muted">{fmtShort(when)}</span>
                    <span className="line-clamp-1 flex-1 text-sm text-foreground">{p.text}</span>
                    {p.mediaPath && <span className="text-xs text-muted">🖼</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {composerOpen && (
        <Composer
          defaultStartDate={selectedDay < new Date() ? new Date() : selectedDay}
          onClose={() => setComposerOpen(false)}
          onPublished={loadPosts}
          onScheduled={async (count, firstSlot) => {
            setComposerOpen(false);
            setNotice(
              `${count} ta post navbatga qo'yildi${firstSlot ? `, birinchisi ${fmtShort(firstSlot)}` : ""}.`
            );
            if (firstSlot) {
              setCursor(firstSlot);
              setSelectedDay(firstSlot);
            }
            await loadPosts();
          }}
        />
      )}
    </div>
  );
}

function PostRow({
  post,
  busy,
  onPublish,
  onDelete,
}: {
  post: XPostRow;
  busy: boolean;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const when = new Date(post.scheduledAt);
  const canSend = post.status === "SCHEDULED" || post.status === "FAILED";
  const canDelete = post.status !== "PUBLISHING";

  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="w-28 shrink-0 text-xs">
        <div className="text-sm text-foreground">{fmtTime(when)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-muted">
          <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[post.status]}`} />
          {STATUS_LABEL[post.status]}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="whitespace-pre-wrap text-sm text-foreground">{post.text}</p>
        {post.mediaPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.mediaPath} alt="" className="max-h-32 rounded-lg" />
        )}
        {post.errorMessage && <p className="text-xs text-red-500">{post.errorMessage}</p>}
        {post.tweetId && (
          <a
            href={tweetUrl(post.tweetId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            X da ochish
          </a>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
        {canSend && (
          <button
            type="button"
            onClick={onPublish}
            disabled={busy}
            className="rounded-lg border border-border px-2 py-1 text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            {busy ? "..." : "Hozir yubor"}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-red-500 hover:underline disabled:opacity-50"
          >
            O&apos;chirish
          </button>
        )}
      </div>
    </li>
  );
}

type PublishResult =
  | { kind: "ok"; tweetId: string | null }
  | { kind: "error"; message: string };

function Composer({
  defaultStartDate,
  onClose,
  onPublished,
  onScheduled,
}: {
  defaultStartDate: Date;
  onClose: () => void;
  onPublished: () => void | Promise<void>;
  onScheduled: (count: number, firstSlot: Date | null) => void | Promise<void>;
}) {
  const [raw, setRaw] = useState("");
  const [files, setFiles] = useState<Record<number, File>>({});
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => toDateInput(defaultStartDate));
  const [days, setDays] = useState(7);
  const [windowStart, setWindowStart] = useState("14:00");
  const [windowEnd, setWindowEnd] = useState("23:30");
  const [minGap, setMinGap] = useState(90);
  const [seed, setSeed] = useState(() => Date.now() % 1_000_000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const items = useMemo(() => splitPosts(raw), [raw]);

  const previews = useMemo(() => {
    const map: Record<number, string> = {};
    for (const [index, file] of Object.entries(files)) {
      map[Number(index)] = URL.createObjectURL(file);
    }
    return map;
  }, [files]);
  useEffect(() => {
    return () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    };
  }, [previews]);

  // Recomputed whenever any input changes; the seed keeps the result stable
  // across re-renders until "Qayta aralashtirish" bumps it.
  const distribution = useMemo<{ slots: Date[] | null; error: string | null }>(() => {
    if (!scheduleOpen || items.length === 0) return { slots: null, error: null };
    try {
      return {
        slots: generateRandomSlots({
          count: items.length,
          startDate,
          days,
          windowStart,
          windowEnd,
          minGapMinutes: minGap,
          random: seededRandom(seed),
        }),
        error: null,
      };
    } catch (e) {
      return { slots: null, error: e instanceof Error ? e.message : "Taqsimlashda xato" };
    }
  }, [scheduleOpen, items, startDate, days, windowStart, windowEnd, minGap, seed]);

  function buildForm(scheduledAt: (index: number) => string): FormData {
    const form = new FormData();
    form.set(
      "items",
      JSON.stringify(
        items.map((text, i) => ({
          text,
          scheduledAt: scheduledAt(i),
          fileIndex: files[i] ? i : null,
        }))
      )
    );
    for (const [index, file] of Object.entries(files)) {
      if (Number(index) < items.length) form.set(`file-${index}`, file);
    }
    return form;
  }

  async function createPosts(form: FormData): Promise<XPostRow[]> {
    const res = await fetch("/api/x/posts", { method: "POST", body: form });
    const json = (await res.json()) as { success: boolean; error?: string; data?: XPostRow[] };
    if (!json.success || !json.data) throw new Error(json.error ?? "Saqlashda xato");
    return json.data;
  }

  async function publishNow() {
    if (items.length !== 1) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [created] = await createPosts(buildForm(() => new Date().toISOString()));
      const res = await fetch(`/api/x/posts/${created.id}/publish`, { method: "POST" });
      const json = (await res.json()) as { success: boolean; error?: string; data?: XPostRow };
      if (!json.success || !json.data) throw new Error(json.error ?? "Yuborishda xato");
      if (json.data.status === "PUBLISHED") {
        setResult({ kind: "ok", tweetId: json.data.tweetId });
      } else {
        setResult({ kind: "error", message: json.data.errorMessage ?? "X qabul qilmadi" });
      }
      await onPublished();
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : "Yuborishda xato" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSchedule() {
    const slots = distribution.slots;
    if (!slots || slots.length !== items.length) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPosts(buildForm((i) => slots[i].toISOString()));
      await onScheduled(created.length, slots[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saqlashda xato");
      setBusy(false);
    }
  }

  const canPublishNow = items.length === 1 && !busy && result?.kind !== "ok";
  const canOpenSchedule = items.length > 0 && !busy && result?.kind !== "ok";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {items.length > 1 ? `Yangi postlar (${items.length})` : "Yangi post"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setResult(null);
              }}
              rows={6}
              autoFocus
              placeholder="Post matni..."
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
            />
            <p className="text-xs text-muted">
              Bir nechta post bo&apos;lsa, oralariga <code className="rounded bg-surface-hover px-1">---</code> qatorini qo&apos;ying.
            </p>
          </div>

          {items.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {items.map((text, i) => {
                const over = text.length > X_CHAR_LIMIT;
                const slot = distribution.slots?.[i];
                return (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-6 shrink-0 text-xs text-muted">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm text-foreground" title={text}>{text}</p>
                      {slot && <p className="mt-0.5 text-xs text-accent">{fmtShort(slot)}</p>}
                    </div>
                    <span className={`shrink-0 text-xs ${over ? "text-error" : "text-muted"}`}>
                      {text.length}/{X_CHAR_LIMIT}
                    </span>
                    {previews[i] ? (
                      <div className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previews[i]} alt="" className="h-12 w-12 rounded-md object-cover" />
                        <button
                          type="button"
                          aria-label="Rasmni olib tashlash"
                          onClick={() =>
                            setFiles((prev) => {
                              const next = { ...prev };
                              delete next[i];
                              return next;
                            })
                          }
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
                        >
                          <X className="h-3 w-3" strokeWidth={3} />
                        </button>
                      </div>
                    ) : (
                      <label
                        title="Rasm qo'shish"
                        className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-muted hover:border-accent/40 hover:text-foreground"
                      >
                        <ImagePlus className="h-4 w-4" />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setFiles((prev) => ({ ...prev, [i]: file }));
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {result?.kind === "ok" && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
              <span>
                Chop etildi.{" "}
                {result.tweetId && (
                  <a href={tweetUrl(result.tweetId)} target="_blank" rel="noreferrer" className="underline">
                    X da ochish
                  </a>
                )}
              </span>
              <button onClick={onClose} className="shrink-0 rounded-lg border border-success/40 px-3 py-1 text-xs">
                Yopish
              </button>
            </div>
          )}
          {result?.kind === "error" && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              Chiqmadi: {result.message}
            </p>
          )}

          {!scheduleOpen && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {items.length > 1 && (
                <span className="mr-auto text-xs text-muted">
                  Bir vaqtda faqat bitta post chiqarish mumkin — ko&apos;p post uchun &quot;Rejalashtirish&quot;.
                </span>
              )}
              <button
                type="button"
                onClick={publishNow}
                disabled={!canPublishNow}
                title={items.length > 1 ? "Bir vaqtda faqat bitta post" : undefined}
                className={canPublishNow ? BTN_SECONDARY : BTN_DISABLED}
              >
                {busy ? "Yuborilmoqda..." : "Hozir chiqarish"}
              </button>
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                disabled={!canOpenSchedule}
                className={canOpenSchedule ? BTN_PRIMARY : BTN_DISABLED}
              >
                Rejalashtirish
              </button>
            </div>
          )}

          {scheduleOpen && (
            <div className="space-y-3 rounded-xl border border-border bg-surface-hover/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rejalashtirish</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Boshlanish</span>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Necha kun</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={days}
                    onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                    className={INPUT}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Soat ...dan</span>
                  <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">...gacha</span>
                  <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Oraliq (daq)</span>
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={minGap}
                    onChange={(e) => setMinGap(Math.max(0, Number(e.target.value) || 0))}
                    className={INPUT}
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                Postlar shu kunlarga bo&apos;linadi va har kuni shu soatlar orasida tasodifiy vaqtda chiqadi.
                Vaqtlar yuqorida har bir post ostida ko&apos;rsatilgan.
              </p>

              {(distribution.error || error) && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {distribution.error ?? error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleOpen(false)}
                  disabled={busy}
                  className="mr-auto text-sm text-muted hover:text-foreground"
                >
                  Orqaga
                </button>
                <button
                  type="button"
                  onClick={() => setSeed((s) => s + 1)}
                  disabled={busy || !distribution.slots}
                  className={distribution.slots && !busy ? BTN_SECONDARY : BTN_DISABLED}
                >
                  Qayta aralashtirish
                </button>
                <button
                  type="button"
                  onClick={confirmSchedule}
                  disabled={busy || !distribution.slots}
                  className={distribution.slots && !busy ? BTN_PRIMARY : BTN_DISABLED}
                >
                  {busy ? "Saqlanmoqda..." : `Tasdiqlash — ${items.length} ta post`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
