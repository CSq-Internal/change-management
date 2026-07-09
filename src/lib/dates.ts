// Shared date formatters so dates read consistently across the app (e.g. the
// change-detail "Jul 20, 2026, 02:00 AM" style) instead of a mix of that and the
// locale-default numeric "7/9/2026, 9:27:27 AM" that bare toLocaleString() gives.

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
