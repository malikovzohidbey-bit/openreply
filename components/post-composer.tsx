"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { computeSlot } from "@/lib/posts/schedule";

interface PostComposerProps {
  accounts: AccountOption[];
  defaultDate: Date;
  onClose: () => void;
  /** Called after each item lands (created or its remote status changes),
   *  so the calendar behind the modal can refresh its dots live. */
  onCreated: () => void;
}

type ItemStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

interface DraftItem {
  id: string;
  file: File | null;
  preview: string | null;
  caption: string;
  isReel: boolean;
  isTrialReel: boolean;
  graduationStrategy: "SS_PERFORMANCE" | "MANUAL";
  accountId: string;

  status: ItemStatus;
  progress: number;
  error: string | null;
  postId: string | null;
  plannedAt: Date | null; // null = post immediately
  plannedAtAssigned: boolean;
  linkUrl: string | null;
  linkPromptDismissed: boolean;
}

function newItem(accountId: string): DraftItem {
  return {
    id: crypto.randomUUID(),
    file: null,
    preview: null,
    caption: "",
    isReel: false,
    isTrialReel: false,
    graduationStrategy: "SS_PERFORMANCE",
    accountId,
    status: "idle",
    progress: 0,
    error: null,
    postId: null,
    plannedAt: null,
    plannedAtAssigned: false,
    linkUrl: null,
    linkPromptDismissed: false,
  };
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  idle: "Kutmoqda",
  uploading: "Yuklanmoqda...",
  uploaded: "Yuklandi, navbatda...",
  SCHEDULED: "Rejalashtirilgan",
  PUBLISHING: "Joylanmoqda...",
  PUBLISHED: "Chop etildi",
  FAILED: "Xato",
};

const STATUS_COLOR: Record<ItemStatus, string> = {
  idle: "bg-zinc-300",
  uploading: "bg-blue-400",
  uploaded: "bg-blue-400",
  SCHEDULED: "bg-amber-400",
  PUBLISHING: "bg-blue-400",
  PUBLISHED: "bg-green-500",
  FAILED: "bg-red-500",
};

function uploadItem(
  item: DraftItem,
  onProgress: (pct: number) => void
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", item.file as File);
    form.set("instagramAccountId", item.accountId);
    form.set("caption", item.caption);
    form.set("isReel", String(item.isReel));
    if (item.isReel) {
      form.set("isTrialReel", String(item.isTrialReel));
      if (item.isTrialReel) form.set("graduationStrategy", item.graduationStrategy);
    }
    if (item.plannedAt) form.set("scheduledAt", item.plannedAt.toISOString());

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/posts");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.success) {
          resolve(json.data);
        } else {
          reject(new Error(json.error ?? `Xato (${xhr.status})`));
        }
      } catch {
        reject(new Error("Serverdan noto'g'ri javob"));
      }
    };
    xhr.onerror = () => reject(new Error("Tarmoq xatosi"));
    xhr.send(form);
  });
}

export default function PostComposer({
  accounts,
  defaultDate,
  onClose,
  onCreated,
}: PostComposerProps) {
  const defaultAccountId = accounts[0]?.id ?? "";
  const [items, setItems] = useState<DraftItem[]>([newItem(defaultAccountId)]);
  const [postFirstNow, setPostFirstNow] = useState(true);
  const [startDate, setStartDate] = useState(toDateInputValue(defaultDate));
  const [timeOfDay, setTimeOfDay] = useState("12:00");
  const assignedCountRef = useRef(0);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Uploads run one after another, so by the time a later item's turn comes
  // the state it was queued with may be stale — the person can still edit or
  // remove anything that hasn't started yet. This mirror lets the loop read
  // what is on screen now instead of the snapshot taken at click time.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function handleFileChange(id: string, file: File | null) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (it.preview) URL.revokeObjectURL(it.preview);
        return { ...it, file, preview: file ? URL.createObjectURL(file) : null };
      })
    );
  }

  function addItem() {
    setItems((prev) => [...prev, newItem(defaultAccountId)]);
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((it) => it.id !== id);
    });
    clearInterval(pollTimers.current[id]);
    delete pollTimers.current[id];
  }

  const pollStatus = useCallback(
    (itemId: string, postId: string) => {
      let lastStatus: ItemStatus | null = null;

      const stop = () => {
        clearInterval(pollTimers.current[itemId]);
        delete pollTimers.current[itemId];
      };

      pollTimers.current[itemId] = setInterval(async () => {
        try {
          const res = await fetch(`/api/posts/${postId}`);
          const json = await res.json();
          if (!json.success) return;

          const remoteStatus: ItemStatus = json.data.status;
          if (remoteStatus !== lastStatus) {
            lastStatus = remoteStatus;
            updateItem(itemId, {
              status: remoteStatus,
              error: json.data.errorMessage ?? null,
            });
            // Only on an actual change: the calendar behind the modal doesn't
            // need a refetch every four seconds while nothing is happening.
            onCreated();
          }

          if (remoteStatus === "PUBLISHED" || remoteStatus === "FAILED") {
            stop();
            return;
          }
          // Scheduled for later — nothing will change for hours or days, so
          // stop watching instead of polling for the life of the modal.
          if (
            remoteStatus === "SCHEDULED" &&
            new Date(json.data.scheduledAt).getTime() > Date.now() + 60_000
          ) {
            stop();
          }
        } catch {
          // Transient network hiccup — next tick tries again.
        }
      }, 4000);
    },
    [onCreated]
  );

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, []);

  async function runUpload(item: DraftItem) {
    updateItem(item.id, { status: "uploading", progress: 0, error: null });
    try {
      const created = await uploadItem(item, (pct) =>
        updateItem(item.id, { progress: pct })
      );
      updateItem(item.id, {
        // An immediate post is already being published server-side; calling
        // that "Rejalashtirilgan" until the first poll lands would read wrong.
        status: item.plannedAt ? "SCHEDULED" : "uploaded",
        progress: 100,
        postId: created.id,
      });
      onCreated();
      pollStatus(item.id, created.id);
    } catch (err) {
      updateItem(item.id, {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Xatolik yuz berdi",
      });
    }
  }

  /** Assigns the next slot in the running one-per-day sequence. Called once
   *  per item, ever — `assignedCountRef` keeps counting across multiple
   *  "Saqlash" clicks (e.g. after adding more blocks later), so new items
   *  slot in after whatever was already scheduled. */
  function assignPlannedAt(): Date | null {
    const orderIndex = assignedCountRef.current;
    assignedCountRef.current += 1;
    return computeSlot(orderIndex, { postFirstNow, startDate, timeOfDay });
  }

  async function handleSubmit() {
    const pending = items.filter((it) => it.file && it.status === "idle");
    if (pending.length === 0) return;

    // Compute every slot up front (synchronous, no state round-trip) so the
    // sequence is stable even though the uploads below run one at a time.
    const plans = pending.map((it) => ({ item: it, plannedAt: assignPlannedAt() }));

    setItems((prev) =>
      prev.map((p) => {
        const plan = plans.find((x) => x.item.id === p.id);
        return plan ? { ...p, plannedAt: plan.plannedAt, plannedAtAssigned: true } : p;
      })
    );

    // Sequential: keeps upload order predictable and avoids saturating the
    // connection when someone queues a dozen videos at once.
    for (const { item, plannedAt } of plans) {
      const current = itemsRef.current.find((x) => x.id === item.id);
      // Removed while it waited its turn, or already handled — either way,
      // uploading the snapshot would publish something nobody asked for.
      if (!current || !current.file || current.status !== "idle") continue;
      await runUpload({ ...current, plannedAt });
    }
  }

  async function retryItem(itemId: string) {
    const item = itemsRef.current.find((it) => it.id === itemId);
    if (!item) return;

    // A failed attempt that got as far as creating a row leaves it sitting on
    // the calendar as a red dot. Retrying uploads a fresh post, so drop the
    // dead one first instead of accumulating a duplicate per attempt.
    if (item.postId) {
      try {
        await fetch(`/api/posts/${item.postId}`, { method: "DELETE" });
        onCreated();
      } catch {
        // Best effort — a stale FAILED row is better than blocking the retry.
      }
    }

    await runUpload({ ...item, postId: null });
  }

  /** Returns an error message to show in the prompt, or null on success. */
  async function saveLink(itemId: string, url: string): Promise<string | null> {
    const item = items.find((it) => it.id === itemId);
    if (!item?.postId) return "Post topilmadi";
    try {
      const res = await fetch(`/api/posts/${item.postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkUrl: url }),
      });
      const json = await res.json();
      if (!json.success) return json.error ?? "Linkni saqlab bo'lmadi";
      updateItem(itemId, { linkUrl: json.data.linkUrl, linkPromptDismissed: true });
      return null;
    } catch {
      return "Tarmoq xatosi — qayta urinib ko'ring";
    }
  }

  const hasPending = items.some((it) => it.file && it.status === "idle");
  const allDone = items.every(
    (it) => !it.file || it.status === "PUBLISHED" || it.status === "FAILED"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-8">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Yangi post{items.length > 1 ? `lar (${items.length})` : ""}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Yopish"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {items.map((item, index) => {
            const locked = item.status !== "idle";
            return (
              <div
                key={item.id}
                className="space-y-3 rounded-xl border border-border bg-surface-hover/40 p-4"
              >
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{index + 1}-post</span>
                  <div className="flex items-center gap-2">
                    {item.status !== "idle" && (
                      <span className="flex items-center gap-1.5 normal-case tracking-normal text-foreground">
                        <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[item.status]}`} />
                        {STATUS_LABEL[item.status]}
                      </span>
                    )}
                    {!locked && items.length > 1 && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-red-500 hover:underline"
                      >
                        O'chirish
                      </button>
                    )}
                  </div>
                </div>

                {item.status === "uploading" && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Instagram akkaunt
                  </span>
                  <select
                    value={item.accountId}
                    disabled={locked}
                    onChange={(e) => updateItem(item.id, { accountId: e.target.value })}
                    className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 disabled:opacity-60"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.username}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted ${
                    locked ? "" : "cursor-pointer hover:border-accent/40"
                  }`}
                >
                  {item.preview ? (
                    item.file?.type.startsWith("video/") ? (
                      <video src={item.preview} className="max-h-40 rounded-lg" controls />
                    ) : (
                      <img src={item.preview} alt="" className="max-h-40 rounded-lg" />
                    )
                  ) : (
                    <>
                      <span>Rasm yoki video tanlash uchun bosing</span>
                      <span className="text-xs">JPG, PNG, MP4, MOV — max 200 MB</span>
                    </>
                  )}
                  <input
                    type="file"
                    disabled={locked}
                    accept="image/jpeg,image/png,video/mp4,video/quicktime"
                    className="hidden"
                    onChange={(e) => handleFileChange(item.id, e.target.files?.[0] ?? null)}
                  />
                </label>

                {item.file?.type.startsWith("video/") && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={item.isReel}
                      disabled={locked}
                      onChange={(e) => updateItem(item.id, { isReel: e.target.checked })}
                    />
                    Reels sifatida joylash
                  </label>
                )}

                {item.isReel && !locked && (
                  <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={item.isTrialReel}
                        onChange={(e) =>
                          updateItem(item.id, { isTrialReel: e.target.checked })
                        }
                      />
                      Sinov reel (Trial Reel) sifatida joylash
                    </label>
                    <p className="text-xs text-muted">
                      Avval faqat obuna bo'lmaganlarga ko'rsatiladi. Faqat ochiq
                      (public) va 1000+ obunachisi bo'lgan akkauntlarda ishlaydi.
                    </p>
                    {item.isTrialReel && (
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs text-muted">
                          Followerlarga qachon chiqadi
                        </span>
                        <select
                          value={item.graduationStrategy}
                          onChange={(e) =>
                            updateItem(item.id, {
                              graduationStrategy: e.target.value as
                                | "SS_PERFORMANCE"
                                | "MANUAL",
                            })
                          }
                          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/40"
                        >
                          <option value="SS_PERFORMANCE">
                            Avtomatik (natija yaxshi bo'lsa)
                          </option>
                          <option value="MANUAL">
                            Qo'lda (Instagram ilovasidan)
                          </option>
                        </select>
                      </label>
                    )}
                  </div>
                )}

                <textarea
                  value={item.caption}
                  disabled={locked}
                  onChange={(e) => updateItem(item.id, { caption: e.target.value })}
                  rows={2}
                  placeholder="Post matni (caption)..."
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 disabled:opacity-60"
                />

                {item.status === "FAILED" && (
                  <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
                    <p>{item.error ?? "Xatolik yuz berdi"}</p>
                    <button
                      onClick={() => retryItem(item.id)}
                      className="mt-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium hover:bg-red-500/10"
                    >
                      Qayta urinish
                    </button>
                  </div>
                )}

                {item.status === "PUBLISHED" && !item.linkPromptDismissed && (
                  <LinkPrompt
                    onSkip={() => updateItem(item.id, { linkPromptDismissed: true })}
                    onSave={(url) => saveLink(item.id, url)}
                  />
                )}

                {item.status === "PUBLISHED" && item.linkPromptDismissed && item.linkUrl && (
                  <p className="truncate text-xs text-muted">
                    Link: <span className="text-accent">{item.linkUrl}</span>
                  </p>
                )}
              </div>
            );
          })}

          <button
            onClick={addItem}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted hover:border-accent/40 hover:text-foreground"
          >
            + Yana post qo'shish
          </button>

          {items.some((it) => it.status === "idle") && (
            <div className="space-y-3 rounded-xl border border-border bg-surface-hover/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Joylash tartibi
              </p>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={postFirstNow}
                  onChange={(e) => setPostFirstNow(e.target.checked)}
                />
                {items.filter((it) => it.file).length > 1
                  ? "Birinchisini hoziroq joylash, qolganlarini kunlarga bo'lish"
                  : "Hozir joylash"}
              </label>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted">Boshlanish sanasi</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted">Vaqt</span>
                  <input
                    type="time"
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                    className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                Har bir keyingi post navbatdagi kunning shu vaqtida joylanadi.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-surface-hover"
            >
              {allDone ? "Yopish" : "Fonda qoldirish"}
            </button>
            {hasPending && (
              <button
                onClick={handleSubmit}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                Saqlash
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkPrompt({
  onSkip,
  onSave,
}: {
  onSkip: () => void;
  onSave: (url: string) => Promise<string | null>;
}) {
  const [asking, setAsking] = useState(true);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(await onSave(trimmed));
    setSaving(false);
  }

  if (!asking) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 rounded-lg border border-border bg-surface-hover/40 px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/40"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? "..." : "Saqlash"}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground">
      <span>Link qo'yamizmi?</span>
      <div className="flex gap-2">
        <button
          onClick={() => setAsking(false)}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          Ha
        </button>
        <button
          onClick={onSkip}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
        >
          Yo'q
        </button>
      </div>
    </div>
  );
}
