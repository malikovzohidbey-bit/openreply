"use client";

/**
 * Jilo reels — analytics for videos the Jilo agent uploads via the posts API
 * (Post.source = "jilo").
 *
 * One row per video: latest insights, derived ratios and a verdict against the
 * account's other Jilo videos (rule: lib/jilo/videos.ts). Clicking a row opens
 * a drawer with the growth curve, every metric, the agent's metadata and the
 * external analyzer's "why it worked / didn't" text.
 */

import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatCard from "@/components/stat-card";
import JiloGrowthChart from "@/components/jilo-growth-chart";
import type {
  JiloVideoDetail,
  JiloVideoRow,
  JiloVideosResponse,
} from "@/lib/jilo/videos";

const TZ = "Asia/Tashkent";

const NOTE =
  "Sekundma-sekund retention Instagram API'da yo'q — skip rate (3 s) va o'rtacha ko'rish % ishlatiladi.";

const DAY_OPTIONS = [
  { value: "30", label: "Oxirgi 30 kun" },
  { value: "90", label: "Oxirgi 90 kun" },
  { value: "180", label: "Oxirgi 180 kun" },
];

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Rejalashtirilgan",
  PUBLISHING: "Joylanmoqda...",
  PUBLISHED: "Chop etildi",
  FAILED: "Xato",
};

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: "bg-amber-400",
  PUBLISHING: "bg-blue-400",
  PUBLISHED: "bg-green-500",
  FAILED: "bg-red-500",
};

// Computed verdicts use "O'RTACHA"; stored analyses use "ORTACHA".
const VERDICT_STYLE: Record<string, { label: string; className: string }> = {
  UCHDI: { label: "UCHDI", className: "bg-success/10 text-success" },
  "O'RTACHA": { label: "O'RTACHA", className: "bg-warning/10 text-warning" },
  ORTACHA: { label: "O'RTACHA", className: "bg-warning/10 text-warning" },
  UCHMADI: { label: "UCHMADI", className: "bg-error/10 text-error" },
  KUTILMOQDA: { label: "KUTILMOQDA", className: "bg-zinc-200/70 text-muted" },
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uz-UZ", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;
}

/** 0..1 share → "1.2%". */
function formatShare(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${(n * 100).toFixed(2)}%`;
}

function formatTimes(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${n.toFixed(2)}×`;
}

function formatSeconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

function formatMinutes(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${formatNumber(ms / 60_000)} daq`;
}

function hookSummary(meta: JiloVideoRow["meta"]): string | null {
  const parts: string[] = [];
  if (meta.hookSec !== null) parts.push(`hook ${meta.hookSec} s`);
  if (meta.hookSource) parts.push(`hook: ${meta.hookSource}`);
  if (meta.captionSource) parts.push(`caption: ${meta.captionSource}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground">
      <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[status] ?? "bg-zinc-400"}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const style = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.KUTILMOQDA;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function Thumb({ src }: { src: string | null }) {
  if (!src) {
    return (
      <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-zinc-200 text-[10px] text-muted">
        reel
      </div>
    );
  }
  return (
    // Instagram CDN URLs expire and vary by host; next/image would need every
    // CDN host allow-listed for no real gain on a 40px thumbnail.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-14 w-10 shrink-0 rounded object-cover"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

function VideoDrawer({
  row,
  onClose,
  onAnalysisCleared,
}: {
  row: JiloVideoRow;
  onClose: () => void;
  onAnalysisCleared: (id: string) => void;
}) {
  const [detail, setDetail] = useState<JiloVideoDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/jilo/videos/${row.id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setDetail(res.data.video);
        else setDetailError(res.error ?? "Ma'lumotni yuklab bo'lmadi");
      })
      .catch(() => setDetailError("Ma'lumotni yuklab bo'lmadi"));
  }, [row.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleReanalyze() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/jilo/videos/${row.id}/analysis`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setCleared(true);
      onAnalysisCleared(row.id);
    } catch {
      setActionError("Tahlilni o'chirib bo'lmadi. Qayta urinib ko'ring.");
    } finally {
      setBusy(false);
    }
  }

  const latest = row.latest;
  const m = row.metrics;
  const meta = detail?.meta ?? row.meta;
  const analysis = cleared ? null : row.analysis;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={row.title}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl"
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
        >
          <div className="flex min-w-0 gap-3">
            <Thumb src={row.thumbnailUrl} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-foreground">
                {row.title}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                @{row.accountUsername} · {formatDateTime(row.publishedAt ?? row.scheduledAt)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusBadge status={row.status} />
                <VerdictBadge verdict={row.verdict} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Yopish"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {row.errorMessage && (
            <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
              {row.errorMessage}
            </p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Ko&apos;rishlar va qamrov o&apos;sishi
            </h3>
            {detailError ? (
              <p className="text-sm text-error">{detailError}</p>
            ) : detail ? (
              <JiloGrowthChart points={detail.snapshots} />
            ) : (
              <div className="h-56 rounded bg-zinc-200/50" />
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Ko&apos;rsatkichlar</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Metric label="Ko'rishlar" value={formatNumber(latest?.views)} />
              <Metric label="Qamrov" value={formatNumber(latest?.reach)} />
              <Metric label="Layklar" value={formatNumber(latest?.likes)} />
              <Metric label="Izohlar" value={formatNumber(latest?.comments)} />
              <Metric label="Ulashishlar" value={formatNumber(latest?.shares)} />
              <Metric label="Saqlanganlar" value={formatNumber(latest?.saved)} />
              <Metric label="Repostlar" value={formatNumber(latest?.reposts)} />
              <Metric label="Jami interaksiya" value={formatNumber(latest?.totalInteractions)} />
              <Metric label="O'rtacha ko'rish" value={formatSeconds(latest?.avgWatchTimeMs)} />
              <Metric label="Umumiy ko'rish" value={formatMinutes(latest?.totalWatchTimeMs)} />
              <Metric label="Skip rate (3 s)" value={formatPct(latest?.skipRatePct)} />
              <Metric label="Obunachilar" value={formatNumber(latest?.followersCount)} />
              <Metric label="24 soatda ko'rishlar" value={formatNumber(row.views24h)} />
              <Metric label="72 soatda ko'rishlar" value={formatNumber(row.views72h)} />
              <Metric label="O'lchovlar soni" value={String(row.snapshotCount)} />
            </div>
            {latest && (
              <p className="mt-3 text-xs text-muted">
                Oxirgi o&apos;lchov: {formatDateTime(latest.capturedAt)}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Nisbatlar</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Metric label="Retention (o'rtacha ko'rish %)" value={formatPct(m.retentionPct)} />
              <Metric label="Qayta ko'rish koeffitsienti" value={formatTimes(m.replayRatio)} />
              <Metric label="Ko'rish / qamrov" value={formatTimes(m.viewsPerReach)} />
              <Metric label="Saqlash ulushi" value={formatShare(m.saveRate)} />
              <Metric label="Ulashish ulushi" value={formatShare(m.shareRate)} />
              <Metric label="Izoh ulushi" value={formatShare(m.commentRate)} />
              <Metric label="Engagement (interaksiya / qamrov)" value={formatShare(m.engagementRate)} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Baho:{" "}
              {row.verdictBasis === null
                ? "video chop etilganiga 24 soat to'lmagan yoki ko'rishlar hali yo'q."
                : `${row.verdictBasis === "views24h" ? "24 soatdagi" : "oxirgi"} ko'rishlar (${formatNumber(row.verdictValue)}) shu akkauntning boshqa ${row.peerCount} ta Jilo videosi medianasi (${formatNumber(row.peerMedian)}) bilan solishtirildi. ≥2× — UCHDI, ≤0.5× — UCHMADI, 3 tadan kam video — KUTILMOQDA.`}
            </p>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Jilo ma&apos;lumotlari</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Metric label="Hook vaqti" value={meta.hookSec !== null ? `${meta.hookSec} s` : "—"} />
              <Metric label="Hook manbasi" value={meta.hookSource ?? "—"} />
              <Metric label="Caption manbasi" value={meta.captionSource ?? "—"} />
              <Metric label="Mapping rejimi" value={meta.mappingMode ?? "—"} />
              <Metric label="Davomiylik" value={meta.durationSec !== null ? `${meta.durationSec} s` : "—"} />
              <Metric label="Rank" value={meta.rank !== null ? String(meta.rank) : "—"} />
              <Metric label="Job" value={meta.jobTitle ?? meta.job ?? "—"} />
            </div>
            {meta.transcriptExcerpt && (
              <div className="mt-3">
                <p className="text-xs text-muted">Transkript parchasi</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {meta.transcriptExcerpt}
                </p>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Caption</h3>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {row.caption || "—"}
            </p>
          </section>

          <section className="rounded border border-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Nega uchdi / nega uchmadi
            </h3>
            {cleared ? (
              <p className="mt-2 text-sm text-muted">Keyingi tahlil 01:00 da yoziladi.</p>
            ) : analysis ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <VerdictBadge verdict={analysis.verdict} />
                  <span>{formatDateTime(analysis.generatedAt)}</span>
                  {analysis.model && <span>· {analysis.model}</span>}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                  {analysis.text}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Tahlil hali yozilmagan (24 soatdan keyin).
              </p>
            )}
            {actionError && <p className="mt-2 text-sm text-error">{actionError}</p>}
          </section>
        </div>

        <div
          className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-6"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {analysis && (
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={busy}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
            >
              {busy ? "..." : "Qayta tahlil"}
            </button>
          )}
          {row.permalink && (
            <a
              href={row.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Instagram&apos;da ochish
            </a>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JiloPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [days, setDays] = useState("90");
  const [data, setData] = useState<JiloVideosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setAccounts(res.data.instagramAccounts ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ days });
    if (accountId !== "all") params.set("accountId", accountId);

    fetch(`/api/jilo/videos?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Jilo videolarini yuklab bo'lmadi");
        }
      })
      .catch(() => setError("Jilo videolarini yuklab bo'lmadi"))
      .finally(() => setLoading(false));
  }, [accountId, days]);

  function handleAccountChange(next: string) {
    setLoading(true);
    setSelectedId(null);
    setAccountId(next);
  }

  function handleDaysChange(next: string) {
    setLoading(true);
    setSelectedId(null);
    setDays(next);
  }

  function handleAnalysisCleared(id: string) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            videos: prev.videos.map((v) => (v.id === id ? { ...v, analysis: null } : v)),
          }
        : prev
    );
  }

  const videos = data?.videos ?? [];
  const totals = data?.totals ?? null;
  const selected = videos.find((v) => v.id === selectedId) ?? null;
  const best = totals?.bestPostId ? videos.find((v) => v.id === totals.bestPostId) : null;
  const followerDelta =
    totals?.followersNow != null && totals.followersAtCampaignStart != null
      ? totals.followersNow - totals.followersAtCampaignStart
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Jilo reels</h1>
          <p className="mt-1 text-sm text-muted">
            Jilo agent yuklagan videolar, ularning natijasi va tahlili.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Oraliq
            </span>
            <select
              value={days}
              onChange={(e) => handleDaysChange(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={handleAccountChange}
            />
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel h-24 rounded p-4 sm:p-5">
              <div className="h-4 w-16 rounded bg-zinc-200" />
              <div className="mt-3 h-6 w-20 rounded bg-zinc-200/60" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="panel rounded p-8 text-center">
          <p className="text-sm text-error">{error}</p>
        </div>
      ) : !totals || videos.length === 0 ? (
        <div className="panel rounded p-8 text-center">
          <p className="text-sm font-medium text-foreground">Hali Jilo videolari yo&apos;q</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Jilo agent reels&apos;ni Avtopost API orqali yuklaganda (source = &quot;jilo&quot;)
            ular shu yerda paydo bo&apos;ladi: navbatdagilari darhol, natijalari esa
            chop etilgandan keyin har soat yangilanib boradi.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            <StatCard
              label="Videolar"
              value={totals.videos}
              hint={`${totals.published} chop · ${totals.scheduled} navbat · ${totals.failed} xato`}
            />
            <StatCard label="Jami ko'rishlar" value={formatNumber(totals.views)} />
            <StatCard label="O'rtacha skip rate (3 s)" value={formatPct(totals.avgSkipRatePct)} />
            <StatCard label="O'rtacha retention %" value={formatPct(totals.avgRetentionPct)} />
            <StatCard
              label="Obunachilar"
              value={formatNumber(totals.followersNow)}
              {...(followerDelta !== null && followerDelta !== 0
                ? {
                    trend: `${followerDelta > 0 ? "+" : ""}${followerDelta.toLocaleString()} kampaniya boshidan`,
                    trendUp: followerDelta > 0,
                  }
                : { hint: followerDelta === 0 ? "Kampaniya boshidan o'zgarmagan" : undefined })}
            />
            <StatCard
              label="Eng yaxshi video"
              value={best ? formatNumber(best.latest?.views) : "—"}
              hint={best ? best.title : undefined}
            />
          </div>

          <p className="text-xs text-muted">{data?.note ?? NOTE}</p>

          <div className="panel rounded p-4 sm:p-6">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Videolar</h2>
            {/* Seventeen columns cannot fit a phone: the table keeps its width
                and scrolls inside the panel. */}
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Video</th>
                    <th className="px-3 py-2 font-medium">Holat</th>
                    <th className="px-3 py-2 font-medium">Vaqt (Toshkent)</th>
                    <th className="px-3 py-2 text-right font-medium">Ko&apos;rishlar</th>
                    <th className="px-3 py-2 text-right font-medium">Qamrov</th>
                    <th className="px-3 py-2 text-right font-medium">Layklar</th>
                    <th className="px-3 py-2 text-right font-medium">Izohlar</th>
                    <th className="px-3 py-2 text-right font-medium">Ulashish</th>
                    <th className="px-3 py-2 text-right font-medium">Saqlash</th>
                    <th className="px-3 py-2 text-right font-medium">Repost</th>
                    <th className="px-3 py-2 text-right font-medium">O&apos;rt. ko&apos;rish</th>
                    <th className="px-3 py-2 text-right font-medium">Umumiy ko&apos;rish</th>
                    <th className="px-3 py-2 text-right font-medium">Skip (3 s)</th>
                    <th className="px-3 py-2 font-medium">Baho</th>
                    <th className="px-3 py-2 font-medium">Hook</th>
                    <th className="py-2 pl-3 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => {
                    const hook = hookSummary(v.meta);
                    return (
                      <tr
                        key={v.id}
                        onClick={() => setSelectedId(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(v.id);
                          }
                        }}
                        tabIndex={0}
                        className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-hover ${
                          v.id === selectedId ? "bg-surface-hover" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <div className="flex max-w-xs items-center gap-3">
                            <Thumb src={v.thumbnailUrl} />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{v.title}</p>
                              <p className="truncate text-xs text-muted">
                                @{v.accountUsername}
                                {v.meta.jobTitle ? ` · ${v.meta.jobTitle}` : ""}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={v.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">
                          {v.publishedAt
                            ? formatDateTime(v.publishedAt)
                            : `reja: ${formatDateTime(v.scheduledAt)}`}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {formatNumber(v.latest?.views)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.reach)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.likes)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.comments)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.shares)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.saved)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatNumber(v.latest?.reposts)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                          {formatSeconds(v.latest?.avgWatchTimeMs)}
                          {v.metrics.retentionPct !== null && (
                            <span className="block text-xs">
                              {formatPct(v.metrics.retentionPct, 0)}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                          {formatMinutes(v.latest?.totalWatchTimeMs)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {formatPct(v.latest?.skipRatePct)}
                        </td>
                        <td className="px-3 py-2">
                          <VerdictBadge verdict={v.verdict} />
                        </td>
                        <td className="max-w-48 px-3 py-2 text-xs text-muted">
                          {hook ?? "—"}
                        </td>
                        <td className="py-2 pl-3">
                          {v.permalink ? (
                            <a
                              href={v.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="whitespace-nowrap text-accent hover:underline"
                            >
                              Instagram
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selected && (
        <VideoDrawer
          key={selected.id}
          row={selected}
          onClose={() => setSelectedId(null)}
          onAnalysisCleared={handleAnalysisCleared}
        />
      )}
    </div>
  );
}
