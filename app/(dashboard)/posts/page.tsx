"use client";

/**
 * Avtopost — content calendar
 *
 * Month view (a cell per day of the month) and week view (7 cells), each
 * cell showing colored dots for that day's posts. Clicking a dot opens the
 * post's detail; clicking empty space on a day opens the composer
 * pre-filled with that date.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PostComposer from "@/components/post-composer";
import type { AccountOption } from "@/components/account-select";

type PostStatus = "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

interface PostRow {
  id: string;
  mediaType: "IMAGE" | "VIDEO" | "REEL";
  filePath: string;
  caption: string | null;
  status: PostStatus;
  scheduledAt: string;
  publishedAt: string | null;
  errorMessage: string | null;
  instagramAccount: { username: string };
}

const STATUS_COLOR: Record<PostStatus, string> = {
  SCHEDULED: "bg-amber-400",
  PUBLISHING: "bg-blue-400",
  PUBLISHED: "bg-green-500",
  FAILED: "bg-red-500",
};

const STATUS_LABEL: Record<PostStatus, string> = {
  SCHEDULED: "Rejalashtirilgan",
  PUBLISHING: "Joylanmoqda...",
  PUBLISHED: "Chop etildi",
  FAILED: "Xato",
};

const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function PostsCalendarPage() {
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(new Date());
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [composerDate, setComposerDate] = useState<Date | null>(null);
  const [detailPost, setDetailPost] = useState<PostRow | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    return { start, end };
  }, [view, cursor]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      const res = await fetch(`/api/posts?${params}`);
      const json = await res.json();
      if (json.success) setPosts(json.data);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setAccounts(json.data.instagramAccounts ?? json.data);
      });
  }, []);

  // Posts publish/process asynchronously — poll while anything is in flight.
  useEffect(() => {
    const hasPending = posts.some(
      (p) => p.status === "PUBLISHING" || p.status === "SCHEDULED"
    );
    if (!hasPending) return;
    const interval = setInterval(loadPosts, 5000);
    return () => clearInterval(interval);
  }, [posts, loadPosts]);

  const days = useMemo(() => {
    const start =
      view === "week" ? range.start : startOfWeek(range.start);
    const end =
      view === "week"
        ? range.end
        : (() => {
            const lastOfMonth = new Date(range.end);
            lastOfMonth.setDate(lastOfMonth.getDate() - 1);
            const gridEnd = startOfWeek(lastOfMonth);
            gridEnd.setDate(gridEnd.getDate() + 7);
            return gridEnd;
          })();

    const result: Date[] = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      result.push(new Date(d));
    }
    return result;
  }, [view, range]);

  function postsOnDay(day: Date): PostRow[] {
    return posts.filter((p) => isSameDay(new Date(p.scheduledAt), day));
  }

  function shiftCursor(direction: 1 | -1) {
    const next = new Date(cursor);
    if (view === "week") next.setDate(next.getDate() + 7 * direction);
    else next.setMonth(next.getMonth() + direction);
    setCursor(next);
  }

  const title = useMemo(() => {
    const monthNames = [
      "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
      "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
    ];
    if (view === "month") return `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const start = range.start;
    const end = new Date(range.end);
    end.setDate(end.getDate() - 1);
    return `${start.getDate()} ${monthNames[start.getMonth()]} — ${end.getDate()} ${monthNames[end.getMonth()]}`;
  }, [view, cursor, range]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Avtopost kalendari</h1>
        <button
          onClick={() => setComposerDate(new Date())}
          disabled={accounts.length === 0}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          + Yangi post
        </button>
      </div>

      {accounts.length === 0 && !loading && (
        <p className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          Avval Sozlamalar bo'limidan Instagram akkaunt ulang.
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
          <span className="min-w-40 text-center text-sm font-medium text-foreground">
            {title}
          </span>
          <button
            onClick={() => shiftCursor(1)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            →
          </button>
          <button
            onClick={() => setCursor(new Date())}
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

      {view === "week" && (
        <p className="mb-3 text-sm text-muted">
          Bu hafta:{" "}
          <span className="font-medium text-foreground">
            {posts.filter((p) => p.status === "PUBLISHED" && p.mediaType === "REEL").length} ta reels
          </span>{" "}
          ·{" "}
          <span className="font-medium text-foreground">
            {posts.filter((p) => p.status === "PUBLISHED").length} ta post
          </span>{" "}
          chop etildi
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      <div
        className={`grid grid-cols-7 gap-1 ${view === "week" ? "" : ""}`}
      >
        {days.map((day) => {
          const inMonth = view === "week" || day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, new Date());
          const dayPosts = postsOnDay(day);

          return (
            <button
              key={day.toISOString()}
              onClick={() => setComposerDate(day)}
              className={`
                flex flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors
                ${view === "week" ? "min-h-32" : "min-h-20"}
                ${inMonth ? "border-border bg-surface" : "border-border/50 bg-surface/50 opacity-50"}
                ${isToday ? "ring-2 ring-accent/50" : ""}
                hover:border-accent/40
              `}
            >
              <span className={`text-xs ${isToday ? "font-semibold text-accent" : "text-muted"}`}>
                {day.getDate()}
              </span>
              <div className="flex flex-wrap gap-1">
                {dayPosts.map((p) => (
                  <span
                    key={p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailPost(p);
                    }}
                    title={`${STATUS_LABEL[p.status]} · @${p.instagramAccount.username}`}
                    className={`h-3 w-3 rounded-full ${STATUS_COLOR[p.status]} hover:ring-2 hover:ring-offset-1`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-xs text-muted">
        {(Object.keys(STATUS_LABEL) as PostStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[s]}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {composerDate && accounts.length > 0 && (
        <PostComposer
          accounts={accounts}
          defaultDate={composerDate}
          onClose={() => setComposerDate(null)}
          onCreated={loadPosts}
        />
      )}

      {detailPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetailPost(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${STATUS_COLOR[detailPost.status]}`}>
                {STATUS_LABEL[detailPost.status]}
              </span>
              <button onClick={() => setDetailPost(null)} className="text-muted hover:text-foreground">✕</button>
            </div>
            {detailPost.mediaType === "IMAGE" ? (
              <img src={detailPost.filePath} alt="" className="mb-3 max-h-64 w-full rounded-lg object-cover" />
            ) : (
              <video src={detailPost.filePath} controls className="mb-3 max-h-64 w-full rounded-lg" />
            )}
            <p className="text-sm text-foreground">{detailPost.caption || "(sarlavhasiz)"}</p>
            <p className="mt-2 text-xs text-muted">
              @{detailPost.instagramAccount.username} ·{" "}
              {new Date(detailPost.scheduledAt).toLocaleString("uz-UZ")}
            </p>
            {detailPost.errorMessage && (
              <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {detailPost.errorMessage}
              </p>
            )}
            {(detailPost.status === "SCHEDULED" || detailPost.status === "FAILED") && (
              <button
                onClick={async () => {
                  await fetch(`/api/posts/${detailPost.id}`, { method: "DELETE" });
                  setDetailPost(null);
                  loadPosts();
                }}
                className="mt-4 w-full rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-500 hover:bg-red-500/10"
              >
                O'chirish
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
