"use client"
import { formatDate, formatDateTime } from "@/lib/dates"
import { useHydrated } from "@/lib/use-hydrated"

/**
 * A date or time in the viewer's zone and locale. The server only knows UTC, so the
 * server pass and hydration render UTC, then this switches to local time.
 */
export function DateTime({ value, dateOnly = false }: { value: string | Date | null | undefined; dateOnly?: boolean }) {
  const local = useHydrated()
  return <>{(dateOnly ? formatDate : formatDateTime)(value, !local)}</>
}
