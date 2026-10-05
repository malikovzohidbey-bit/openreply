"use client";

/**
 * Jilo Video Growth
 *
 * Views and reach of one reel over the capture times the insights cron
 * recorded. Both are counts, so they share one y-axis. Styled like
 * FollowerChart (same grid/axis tokens, same diagram/table toggle); the table
 * is also the fallback for the accent line's sub-3:1 contrast.
 */

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface GrowthPoint {
  capturedAt: string;
  views: number | null;
  reach: number | null;
}

// Validated pair (dataviz validator, light surface): ΔE 32.8 worst CVD.
const VIEWS_COLOR = "#f97316";
const REACH_COLOR = "#2563eb";
const GRID_COLOR = "#e4e4e7";
const AXIS_TEXT = "#71717a";

const TZ = "Asia/Tashkent";

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatTick(ms: number): string {
  return new Date(ms).toLocaleString("uz-UZ", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ChartRow {
  t: number;
  views: number | null;
  reach: number | null;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{formatTick(p.t)}</p>
      <p className="mt-1 flex items-center gap-2 text-foreground">
        <span className="inline-block h-0.5 w-3" style={{ background: VIEWS_COLOR }} />
        Ko&apos;rishlar: <span className="font-semibold">{p.views?.toLocaleString() ?? "—"}</span>
      </p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="inline-block h-0.5 w-3" style={{ background: REACH_COLOR }} />
        Qamrov: <span className="font-semibold">{p.reach?.toLocaleString() ?? "—"}</span>
      </p>
    </div>
  );
}

export default function JiloGrowthChart({ points }: { points: GrowthPoint[] }) {
  const [showTable, setShowTable] = useState(false);

  const rows: ChartRow[] = points.map((p) => ({
    t: new Date(p.capturedAt).getTime(),
    views: p.views,
    reach: p.reach,
  }));

  if (rows.length < 2) {
    return (
      <div className="rounded border border-border bg-background p-4 text-center">
        <p className="text-sm text-foreground">O&apos;sish grafigi yig&apos;ilmoqda</p>
        <p className="mt-1 text-xs text-muted">
          {rows.length === 0
            ? "Hali birorta o'lchov yo'q."
            : "Hozircha bitta o'lchov bor."}{" "}
          Dastlabki 48 soatda har soat yangi nuqta qo&apos;shiladi.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: VIEWS_COLOR }} />
            Ko&apos;rishlar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: REACH_COLOR }} />
            Qamrov
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
        >
          {showTable ? "Diagrammani ko'rsatish" : "Jadvalni ko'rsatish"}
        </button>
      </div>

      {showTable ? (
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Vaqt</th>
                <th className="py-2 px-3 text-right font-medium">Ko&apos;rishlar</th>
                <th className="py-2 pl-3 text-right font-medium">Qamrov</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.t} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-4 text-foreground">{formatTick(r.t)}</td>
                  <td className="py-1.5 px-3 text-right text-muted">
                    {r.views?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-1.5 pl-3 text-right text-muted">
                    {r.reach?.toLocaleString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatTick}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                stroke={GRID_COLOR}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                stroke={GRID_COLOR}
                tickLine={false}
                width={48}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="views"
                name="Ko'rishlar"
                stroke={VIEWS_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, fill: VIEWS_COLOR, stroke: "#ffffff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="reach"
                name="Qamrov"
                stroke={REACH_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, fill: REACH_COLOR, stroke: "#ffffff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
