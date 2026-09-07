"use client";

import { useState } from "react";
import type { AccountOption } from "@/components/account-select";

interface PostComposerProps {
  accounts: AccountOption[];
  defaultDate: Date;
  onClose: () => void;
  onCreated: () => void;
}

interface DraftItem {
  id: string;
  file: File | null;
  preview: string | null;
  caption: string;
  isReel: boolean;
  isTrialReel: boolean;
  graduationStrategy: "SS_PERFORMANCE" | "MANUAL";
  accountId: string;
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
  };
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }

  /** Item i's send time: first item now (if postFirstNow) else startDate+0,
   *  every later item one calendar day after the previous, all at timeOfDay. */
  function scheduledAtFor(index: number): Date | null {
    if (index === 0 && postFirstNow) return null; // null = publish immediately
    const [hh, mm] = timeOfDay.split(":").map(Number);
    const base = new Date(startDate + "T00:00:00");
    const dayOffset = postFirstNow ? index : index; // day 0 = startDate for item 0 when not posting first now
    base.setDate(base.getDate() + dayOffset);
    base.setHours(hh, mm, 0, 0);
    return base;
  }

  async function handleSubmit() {
    setError(null);
    const ready = items.filter((it) => it.file);
    if (ready.length === 0) {
      setError("Kamida bitta rasm yoki video tanlang");
      return;
    }
    if (ready.some((it) => !it.accountId)) {
      setError("Har bir post uchun Instagram akkaunt tanlang");
      return;
    }

    setSubmitting(true);
    setProgress({ done: 0, total: ready.length });
    try {
      for (let i = 0; i < ready.length; i++) {
        const item = ready[i];
        const scheduledAt = scheduledAtFor(i);

        const form = new FormData();
        form.set("file", item.file as File);
        form.set("instagramAccountId", item.accountId);
        form.set("caption", item.caption);
        form.set("isReel", String(item.isReel));
        if (item.isReel) {
          form.set("isTrialReel", String(item.isTrialReel));
          if (item.isTrialReel) {
            form.set("graduationStrategy", item.graduationStrategy);
          }
        }
        if (scheduledAt) form.set("scheduledAt", scheduledAt.toISOString());

        const res = await fetch("/api/posts", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(
            `"${item.file?.name ?? i + 1}-post" uchun xato: ${json.error ?? "Noma'lum xatolik"}`
          );
        }
        setProgress({ done: i + 1, total: ready.length });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

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
          {items.map((item, index) => (
            <div
              key={item.id}
              className="space-y-3 rounded-xl border border-border bg-surface-hover/40 p-4"
            >
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                <span>{index + 1}-post</span>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-red-500 hover:underline"
                  >
                    O'chirish
                  </button>
                )}
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Instagram akkaunt
                </span>
                <select
                  value={item.accountId}
                  onChange={(e) => updateItem(item.id, { accountId: e.target.value })}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted hover:border-accent/40">
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
                    onChange={(e) => updateItem(item.id, { isReel: e.target.checked })}
                  />
                  Reels sifatida joylash
                </label>
              )}

              {item.isReel && (
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
                onChange={(e) => updateItem(item.id, { caption: e.target.value })}
                rows={2}
                placeholder="Post matni (caption)..."
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
              />
            </div>
          ))}

          <button
            onClick={addItem}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted hover:border-accent/40 hover:text-foreground"
          >
            + Yana post qo'shish
          </button>

          <div className="space-y-3 rounded-xl border border-border bg-surface-hover/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Joylash tartibi
            </p>

            {items.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={postFirstNow}
                  onChange={(e) => setPostFirstNow(e.target.checked)}
                />
                Birinchisini hoziroq joylash, qolganlarini kunlarga bo'lish
              </label>
            )}
            {items.length === 1 && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={postFirstNow}
                  onChange={(e) => setPostFirstNow(e.target.checked)}
                />
                Hozir joylash
              </label>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted">
                  {postFirstNow && items.length > 1 ? "2-postdan boshlab sana" : "Boshlanish sanasi"}
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={items.length === 1 && postFirstNow}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted">Vaqt</span>
                <input
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  disabled={items.length === 1 && postFirstNow}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 disabled:opacity-50"
                />
              </label>
            </div>

            {items.length > 1 && (
              <p className="text-xs text-muted">
                Har bir post keyingi kunning shu vaqtida avtomatik joylanadi (kuniga 1 tadan).
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {progress && (
            <p className="text-sm text-muted">
              Yuklanmoqda: {progress.done}/{progress.total}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-surface-hover"
            >
              Bekor qilish
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
