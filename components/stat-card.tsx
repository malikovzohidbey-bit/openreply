/**
 * Stat Card
 *
 * Metric panel with label, value, and optional trend.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  /** Muted secondary line under the value (truncated to one line). */
  hint?: string;
}

export default function StatCard({ label, value, trend, trendUp, hint }: StatCardProps) {
  return (
    <div className="panel rounded p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      {hint && (
        <p className="mt-1 truncate text-xs text-muted" title={hint}>
          {hint}
        </p>
      )}
      {trend && (
        <p className={`text-xs mt-1 ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "O'sish" : "Pasayish"} {trend}
        </p>
      )}
    </div>
  );
}
