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

/**
 * A stored instant as a `datetime-local` input value ("YYYY-MM-DDTHH:mm") in the viewer's
 * zone. The form reads the input back with new Date(value), also local, so the two match;
 * slicing toISOString() would show UTC and move the time on every save outside UTC.
 */
export function toDateTimeLocal(value: string | Date | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** A date input's "YYYY-MM-DD" as the first or last instant of that day in the viewer's zone. */
export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00`)
export const dayEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999`)

/** "YYYY-MM-DD HH:mm UTC" for server-rendered text (emails, Chat, PDF) read in many zones. */
export const utcStamp = (d: Date | string) => `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC`
