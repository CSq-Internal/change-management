"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { rescheduleChange } from "@/server/actions/changes"
import { createBlackoutPeriod, deleteBlackoutPeriod } from "@/server/actions/blackout"
import type { RiskLevel } from "@/lib/calendar"

export type CalDay = { key: string; inMonth: boolean; dayNum: number | null; isToday: boolean }
export type CalChipData = {
  id: string; title: string; opcoName: string; riskLevel: string; status: string
  startMs: number; endMs: number; timeLabel: string; day: string
  overlap: boolean; blackout: boolean; severity: RiskLevel | null
  blackoutLabels: string[]; canReschedule: boolean
}
export type BlackoutScope = { value: string; label: string }
export type BlackoutRow = { id: string; label: string; scopeName: string; startMs: number; endMs: number }

const SEVERITY_RING: Record<string, string> = {
  low: "ring-emerald-400", medium: "ring-amber-400", high: "ring-orange-500", emergency: "ring-rose-500",
}

// Chip background by risk level (the overlap conflict stays a separate ring signal).
const RISK_BG: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60",
  medium: "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60",
  high: "bg-orange-100 text-orange-900 hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-100 dark:hover:bg-orange-900/60",
  emergency: "bg-rose-100 text-rose-900 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-100 dark:hover:bg-rose-900/60",
}
const RISK_FALLBACK = "bg-muted hover:bg-muted/70"
// Left-border accent for the mobile agenda rows.
const RISK_BORDER: Record<string, string> = {
  low: "border-l-emerald-400", medium: "border-l-amber-400", high: "border-l-orange-500", emergency: "border-l-rose-500",
}
const RISK_DOT: Record<string, string> = {
  low: "bg-emerald-400", medium: "bg-amber-400", high: "bg-orange-500", emergency: "bg-rose-500",
}
const RISK_LEVELS = ["low", "medium", "high", "emergency"] as const

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function formatDayLabel(key: string, language: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export default function CalendarClient({
  monthLabel, prevMonth, nextMonth, cells, chips,
  canManageBlackouts = false, blackoutScopes = [], blackouts = [],
}: {
  monthLabel: string; prevMonth: string; nextMonth: string; cells: CalDay[]; chips: CalChipData[]
  canManageBlackouts?: boolean; blackoutScopes?: BlackoutScope[]; blackouts?: BlackoutRow[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dragId, setDragId] = useState<string | null>(null)
  const [boScope, setBoScope] = useState(blackoutScopes[0]?.value ?? "")
  const [boLabel, setBoLabel] = useState("")
  const [boStart, setBoStart] = useState("")
  const [boEnd, setBoEnd] = useState("")

  const addBlackout = () => {
    if (!boLabel || !boStart || !boEnd) {
      toast({ title: t(language, "calendar.blackout.incomplete"), variant: "error" })
      return
    }
    startTransition(async () => {
      try {
        await createBlackoutPeriod({
          opcoSlug: boScope || null,
          label: boLabel,
          startsAt: new Date(boStart),
          endsAt: new Date(boEnd),
        })
        setBoLabel(""); setBoStart(""); setBoEnd("")
        toast({ title: t(language, "calendar.blackout.created"), variant: "success" })
        router.refresh()
      } catch (err) {
        toast({ title: t(language, "calendar.blackout.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
      }
    })
  }

  const removeBlackout = (id: string) => {
    startTransition(async () => {
      try {
        await deleteBlackoutPeriod(id)
        toast({ title: t(language, "calendar.blackout.removed"), variant: "success" })
        router.refresh()
      } catch (err) {
        toast({ title: t(language, "calendar.blackout.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
      }
    })
  }

  const chipsByDay = new Map<string, CalChipData[]>()
  for (const c of chips) {
    const arr = chipsByDay.get(c.day) ?? []
    arr.push(c)
    chipsByDay.set(c.day, arr)
  }
  for (const arr of chipsByDay.values()) arr.sort((a, b) => a.startMs - b.startMs)
  const agenda = [...chipsByDay.entries()].sort(([a], [b]) => a.localeCompare(b))

  const onDrop = (dayKey: string) => {
    const chip = chips.find((c) => c.id === dragId)
    setDragId(null)
    if (!chip || chip.day === dayKey) return
    const [y, m, d] = dayKey.split("-").map(Number)
    const oldStart = new Date(chip.startMs)
    const newStart = new Date(y, m - 1, d, oldStart.getHours(), oldStart.getMinutes(), 0, 0)
    const delta = newStart.getTime() - chip.startMs
    const newEnd = new Date(chip.endMs + delta)
    startTransition(async () => {
      try {
        await rescheduleChange(chip.id, newStart.toISOString(), newEnd.toISOString())
        toast({ title: t(language, "calendar.reschedule.success"), variant: "success" })
        router.refresh()
      } catch (err) {
        toast({
          title: t(language, "calendar.reschedule.failed"),
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{monthLabel}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "calendar.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/calendar?month=${prevMonth}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">‹ {t(language, "calendar.prev")}</Link>
          <Link href="/calendar" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">{t(language, "calendar.today")}</Link>
          <Link href={`/calendar?month=${nextMonth}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">{t(language, "calendar.next")} ›</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">{t(language, "calendar.legend")}</span>
        {RISK_LEVELS.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-full ${RISK_DOT[r]}`} />
            {t(language, `riskLevel.${r}`)}
          </span>
        ))}
      </div>

      <Card className="hidden border-border/80 bg-card/95 sm:block">
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-px text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (<div key={w} className="px-2 py-1">{w}</div>))}
          </div>
          <div className={`grid grid-cols-7 gap-px ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
            {cells.map((cell) => {
              const dayChips = cell.inMonth ? (chipsByDay.get(cell.key) ?? []) : []
              return (
                <div
                  key={cell.key}
                  onDragOver={(e) => { if (cell.inMonth) e.preventDefault() }}
                  onDrop={() => { if (cell.inMonth) onDrop(cell.key) }}
                  className={`min-h-24 rounded-md border p-1 ${cell.inMonth ? "border-border/60 bg-background" : "border-transparent bg-muted/30"} ${cell.isToday ? "ring-2 ring-primary/60" : ""}`}
                >
                  {cell.dayNum != null && (
                    <div className={`mb-1 text-xs ${cell.isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{cell.dayNum}</div>
                  )}
                  <div className="space-y-1">
                    {dayChips.map((chip) => (
                      <Link
                        key={chip.id}
                        href={`/changes/${chip.id}`}
                        draggable={chip.canReschedule}
                        onDragStart={() => setDragId(chip.id)}
                        title={[
                          `${chip.title} · ${chip.opcoName} · ${chip.timeLabel}`,
                          chip.overlap ? t(language, "calendar.conflict.overlap") : "",
                          chip.blackout ? `${t(language, "calendar.conflict.blackout")}: ${chip.blackoutLabels.join(", ")}` : "",
                        ].filter(Boolean).join("\n")}
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${RISK_BG[chip.riskLevel] ?? RISK_FALLBACK} ${chip.canReschedule ? "cursor-grab" : ""} ${chip.overlap && chip.severity ? `ring-2 ${SEVERITY_RING[chip.severity]}` : ""}`}
                      >
                        {chip.blackout && <span title={t(language, "calendar.conflict.blackout")}>🚫 </span>}
                        {chip.overlap && <span title={t(language, "calendar.conflict.overlap")}>⚠ </span>}
                        <span className="text-muted-foreground">{chip.timeLabel}</span> {chip.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Mobile agenda: chronological list of this month's changes (the 7-col grid is unusable at phone width) */}
      <div className="space-y-4 sm:hidden">
        {agenda.length === 0 ? (
          <Card className="border-border/80 bg-card/95">
            <CardContent className="p-4 text-sm text-muted-foreground">{t(language, "calendar.empty")}</CardContent>
          </Card>
        ) : (
          agenda.map(([dayKey, dayChips]) => (
            <div key={dayKey} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{formatDayLabel(dayKey, language)}</h2>
              <div className="space-y-1.5">
                {dayChips.map((chip) => (
                  <Link
                    key={chip.id}
                    href={`/changes/${chip.id}`}
                    className={`block rounded-md border border-l-4 border-border bg-card p-2.5 hover:bg-muted/40 ${RISK_BORDER[chip.riskLevel] ?? ""}`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {chip.blackout && <span title={t(language, "calendar.conflict.blackout")}>🚫</span>}
                      {chip.overlap && <span title={t(language, "calendar.conflict.overlap")}>⚠</span>}
                      <span className="font-medium">{chip.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {chip.timeLabel} · {chip.opcoName}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {canManageBlackouts && (
        <Card className="border-border/80 bg-card/95">
          <CardContent className="space-y-4 p-4">
            <div>
              <h2 className="text-sm font-semibold">{t(language, "calendar.blackout.title")}</h2>
              <p className="text-xs text-muted-foreground">{t(language, "calendar.blackout.subtitle")}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t(language, "calendar.blackout.label")}
                <input
                  type="text"
                  value={boLabel}
                  onChange={(e) => setBoLabel(e.target.value)}
                  placeholder={t(language, "calendar.blackout.labelPlaceholder")}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
              {blackoutScopes.length > 1 && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t(language, "calendar.blackout.scope")}
                  <select
                    value={boScope}
                    onChange={(e) => setBoScope(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  >
                    {blackoutScopes.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t(language, "calendar.blackout.start")}
                <input type="datetime-local" value={boStart} onChange={(e) => setBoStart(e.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t(language, "calendar.blackout.end")}
                <input type="datetime-local" value={boEnd} onChange={(e) => setBoEnd(e.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <button
                type="button"
                onClick={addBlackout}
                disabled={isPending}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {t(language, "calendar.blackout.add")}
              </button>
            </div>

            <div className="space-y-1.5">
              {blackouts.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t(language, "calendar.blackout.none")}</p>
              ) : (
                blackouts.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{b.label}</span>
                      <span className="text-muted-foreground"> · {b.scopeName} · {formatDayLabel(new Date(b.startMs).toISOString().slice(0, 10), language)} → {formatDayLabel(new Date(b.endMs).toISOString().slice(0, 10), language)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBlackout(b.id)}
                      disabled={isPending}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {t(language, "calendar.blackout.remove")}
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
