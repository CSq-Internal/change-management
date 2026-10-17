"use client"
import { dateLocale, formatDate, formatDateTime } from "@/lib/dates"
import { useStore } from "@/lib/store"
import { useHydrated } from "@/lib/use-hydrated"

/**
 * A date or time in the viewer's zone and locale. The server only knows UTC, so the
 * server pass and hydration render UTC, then this switches to local time, in the
 * app language.
 */
export function DateTime({ value, dateOnly = false }: { value: string | Date | null | undefined; dateOnly?: boolean }) {
  const local = useHydrated()
  const language = useStore((s) => s.language)
  return <>{(dateOnly ? formatDate : formatDateTime)(value, !local, dateLocale(language))}</>
}
