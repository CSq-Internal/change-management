"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { rescheduleChange } from "@/server/actions/changes"
import type { RiskLevel } from "@/lib/calendar"

export type CalDay = { key: string; inMonth: boolean; dayNum: number | null; isToday: boolean }
export type CalChipData = {
  id: string; title: string; opcoName: string; riskLevel: string; status: string
  startMs: number; endMs: number; timeLabel: string; day: string
  overlap: boolean; blackout: boolean; severity: RiskLevel | null
  blackoutLabels: string[]; canReschedule: boolean
}

const SEVERITY_RING: Record<string, string> = {
  low: "ring-emerald-400", medium: "ring-amber-400", high: "ring-orange-500", emergency: "ring-rose-500",
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export default function CalendarClient({
  monthLabel, prevMonth, nextMonth, cells, chips,
}: {
  monthLabel: string; prevMonth: string; nextMonth: string; cells: CalDay[]; chips: CalChipData[]
}) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dragId, setDragId] = useState<string | null>(null)

  const chipsByDay = new Map<string, CalChipData[]>()
  for (const c of chips) {
    const arr = chipsByDay.get(c.day) ?? []
    arr.push(c)
    chipsByDay.set(c.day, arr)
  }
  for (const arr of chipsByDay.values()) arr.sort((a, b) => a.startMs - b.startMs)

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

      <Card className="border-border/80 bg-card/95">
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
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight bg-muted hover:bg-muted/70 ${chip.canReschedule ? "cursor-grab" : ""} ${chip.overlap && chip.severity ? `ring-2 ${SEVERITY_RING[chip.severity]}` : ""}`}
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
    </div>
  )
}
