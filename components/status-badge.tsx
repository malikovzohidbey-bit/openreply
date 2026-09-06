/**
 * Status label for DM status. Plain text; color carries the state.
 */

const statusConfig: Record<string, { text: string; label: string }> = {
  SENT: { text: "text-success", label: "Yuborildi" },
  FAILED: { text: "text-error", label: "Xatolik" },
  PENDING: { text: "text-warning", label: "Kutilmoqda" },
  SKIPPED_DEDUP: { text: "text-muted", label: "Takror" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", label: "Limit tufayli to'xtatildi" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", label: "O'tkazib yuborildi" },
  SKIPPED_NO_MATCH: { text: "text-muted", label: "Mos kelmadi" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`shrink-0 whitespace-nowrap text-sm ${config.text}`}>
      {config.label}
    </span>
  );
}
