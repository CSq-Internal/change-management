import Link from "next/link"
import { ListChecks } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DashboardData, WorklistItem } from "@/lib/dashboard-metrics"
import { RiskPill } from "@/components/change-badges"

const SEV_BORDER: Record<WorklistItem["severity"], string> = {
  over: "border-l-rose-500", soon: "border-l-amber-500", go: "border-l-primary",
}
const SEV_WHY: Record<WorklistItem["severity"], string> = {
  over: "text-rose-600 dark:text-rose-400", soon: "text-amber-600 dark:text-amber-400", go: "text-muted-foreground",
}

function Chip({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="p-3">
        <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{n}</div>
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function Row({ item, language }: { item: WorklistItem; language: Language }) {
  return (
    <Link
      href={`/changes/${item.id}`}
      className={`flex items-center gap-3 rounded-xl border border-l-[3px] ${SEV_BORDER[item.severity]} border-border bg-card/90 px-3.5 py-3 shadow-sm transition-colors hover:bg-muted/50`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{item.ownerInitials}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          {item.opcoName}
          <RiskPill risk={item.risk} />
          <span className={`font-medium ${SEV_WHY[item.severity]}`}>{item.why}</span>
        </div>
      </div>
      <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground">{t(language, `dashboard.action.${item.action}`)}</span>
    </Link>
  )
}

function GroupHeader({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <div className="mb-2 mt-3.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${dot}`} />{label}
      <span className="ml-auto font-mono tabular-nums text-muted-foreground/70">{count}</span>
    </div>
  )
}

export function TriageView({ data, language }: { data: DashboardData; language: Language }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Chip n={data.counts.breached} label={t(language, "dashboard.triage.overdueCount")} tone="text-rose-600 dark:text-rose-400" />
        <Chip n={data.counts.pending} label={t(language, "dashboard.triage.toDecide")} tone="text-primary" />
        <Chip n={data.counts.readyToAdvance} label={t(language, "dashboard.triage.toAdvance")} tone="text-amber-600 dark:text-amber-400" />
        <Chip n={data.counts.scheduledToday} label={t(language, "dashboard.triage.scheduledToday")} tone="text-foreground" />
      </div>

      <Card className="border-border/80 bg-card/90">
        <CardHeader className="flex flex-row items-center justify-between pb-1">
          <CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4 text-primary" /> {t(language, "dashboard.triage.worklist")}</CardTitle>
          <span className="text-xs text-muted-foreground">{t(language, "dashboard.triage.sortedByUrgency")}</span>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <GroupHeader dot="bg-rose-500" label={t(language, "dashboard.triage.overdue")} count={data.triage.overdue.length} />
          {data.triage.overdue.map((it) => <Row key={it.id} item={it} language={language} />)}
          <GroupHeader dot="bg-amber-500" label={t(language, "dashboard.triage.awaiting")} count={data.triage.awaiting.length} />
          {data.triage.awaiting.map((it) => <Row key={it.id} item={it} language={language} />)}
          <GroupHeader dot="bg-primary" label={t(language, "dashboard.triage.advance")} count={data.triage.advance.length} />
          {data.triage.advance.map((it) => <Row key={it.id} item={it} language={language} />)}
        </CardContent>
      </Card>
    </div>
  )
}
