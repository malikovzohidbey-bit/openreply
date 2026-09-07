"use client";

/**
 * Reels Insights — Skip Rate Over Time
 *
 * Bar chart of each reel's "dropped off in the first 3 seconds" rate,
 * chronological left-to-right, styled to match FollowerChart (same colors,
 * same diagram/table toggle pattern) so the Overview page reads as one system.
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

export interface ReelInsightPoint {
  id: string;
  caption: string | null;
  permalink: string | null;
  timestamp: string;
  skipRatePct: number;
  avgWatchTimeSec: number | null;
  totalWatchTimeSec: number | null;
  views: number | null;
}

const GRID_COLOR = "#e4e4e7";
const AXIS_TEXT = "#71717a";
const COLOR_GOOD = "#16a34a";
const COLOR_WARN = "#d97706";
const COLOR_BAD = "#dc2626";

function barColor(pct: number): string {
  if (pct >= 50) return COLOR_BAD;
  if (pct >= 30) return COLOR_WARN;
  return COLOR_GOOD;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatSeconds(sec: number | null): string {
  if (sec === null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ReelInsightPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="max-w-56 rounded border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{formatDay(p.timestamp)}</p>
      <p className="mt-1 truncate font-semibold text-foreground">
        {p.caption || "Reel"}
      </p>
      <p className="mt-1" style={{ color: barColor(p.skipRatePct) }}>
        {p.skipRatePct.toFixed(0)}% 3s'da tashlab ketdi
      </p>
      <p className="text-muted">O'rtacha ko'rish: {formatSeconds(p.avgWatchTimeSec)}</p>
      <p className="text-muted">Ko'rishlar: {formatNumber(p.views)}</p>
    </div>
  );
}

export default function ReelsInsightsChart({ data }: { data: ReelInsightPoint[] }) {
  const [showTable, setShowTable] = useState(false);
  // Held by id, not by value: switching account or date range swaps `data`
  // out from under us, and a captured object would keep showing the old
  // reel's numbers under a heading that no longer belongs to this set.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.find((p) => p.id === selectedId) ?? null;
  const setSelected = (point: ReelInsightPoint | null) =>
    setSelectedId(point?.id ?? null);

  const chronological = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const worstFirst = [...data].sort((a, b) => b.skipRatePct - a.skipRatePct);

  return (
    <div className="panel rounded p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Reels chuqur tahlili
          </h2>
          <p className="mt-1 text-sm text-muted">
            Har bir reel — ustunga (yoki qatorga) bosib batafsilini ko'ring.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
        >
          {showTable ? "Diagrammani ko'rsatish" : "Jadvalni ko'rsatish"}
        </button>
      </div>

      {selected && (
        <div className="mt-4 rounded-xl border border-border bg-surface-hover/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {selected.permalink ? (
                <a
                  href={selected.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-medium text-foreground hover:text-accent"
                >
                  {selected.caption || "Reel"}
                </a>
              ) : (
                <p className="truncate font-medium text-foreground">
                  {selected.caption || "Reel"}
                </p>
              )}
              <p className="text-xs text-muted">{formatDay(selected.timestamp)}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted hover:text-foreground"
              aria-label="Yopish"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">3s'da tashlab ketish</p>
              <p
                className="text-lg font-semibold"
                style={{ color: barColor(selected.skipRatePct) }}
              >
                {selected.skipRatePct.toFixed(0)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">O'rtacha ko'rish</p>
              <p className="text-lg font-semibold text-foreground">
                {formatSeconds(selected.avgWatchTimeSec)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Umumiy ko'rish</p>
              <p className="text-lg font-semibold text-foreground">
                {formatSeconds(selected.totalWatchTimeSec)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Ko'rishlar</p>
              <p className="text-lg font-semibold text-foreground">
                {formatNumber(selected.views)}
              </p>
            </div>
          </div>
        </div>
      )}

      {showTable ? (
        <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-border">
                <th className="py-2 pr-4 font-medium">Reel</th>
                <th className="py-2 px-3 font-medium text-right">3s'da tashlab ketish</th>
                <th className="py-2 px-3 font-medium text-right">O'rtacha ko'rish</th>
                <th className="py-2 px-3 font-medium text-right">Umumiy ko'rish</th>
                <th className="py-2 px-3 font-medium text-right">Ko'rishlar</th>
                <th className="py-2 pl-3 font-medium text-right">Sana</th>
              </tr>
            </thead>
            <tbody>
              {worstFirst.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-hover"
                >
                  <td className="py-3 pr-4 max-w-xs">
                    {p.permalink ? (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-foreground hover:text-accent truncate block"
                      >
                        {p.caption || "Reel"}
                      </a>
                    ) : (
                      <span className="text-foreground truncate block">
                        {p.caption || "Reel"}
                      </span>
                    )}
                  </td>
                  <td
                    className="py-3 px-3 text-right font-medium"
                    style={{ color: barColor(p.skipRatePct) }}
                  >
                    {p.skipRatePct.toFixed(0)}%
                  </td>
                  <td className="py-3 px-3 text-right text-muted">
                    {formatSeconds(p.avgWatchTimeSec)}
                  </td>
                  <td className="py-3 px-3 text-right text-muted">
                    {formatSeconds(p.totalWatchTimeSec)}
                  </td>
                  <td className="py-3 px-3 text-right text-muted">
                    {formatNumber(p.views)}
                  </td>
                  <td className="py-3 pl-3 text-right text-zinc-500">
                    {formatDay(p.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6 h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chronological}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatDay}
                tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                stroke={GRID_COLOR}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                stroke={GRID_COLOR}
                tickLine={false}
                width={40}
                domain={[0, 100]}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Bar
                dataKey="skipRatePct"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const point = (entry as { payload?: ReelInsightPoint })?.payload;
                  if (point) setSelected(point);
                }}
              >
                {chronological.map((p) => (
                  <Cell key={p.id} fill={barColor(p.skipRatePct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
