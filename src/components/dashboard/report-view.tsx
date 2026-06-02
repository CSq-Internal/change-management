import { Shield, ChartPie, ChartBar, LayoutGrid } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DashboardData } from "@/lib/dashboard-metrics"
import { RiskDonut, OpcoBars, StatusDistribution } from "./charts"

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="p-3.5">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

export function ReportView({ data, language }: { data: DashboardData; language: Language }) {
  return (
    <div className="space-y-3">
      <Card className="border-border/80 bg-card/90">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.health")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Kpi label={t(language, "dashboard.report.open")} value={data.counts.open} />
            <Kpi label={t(language, "dashboard.report.pending")} value={data.counts.pending} />
            <Kpi label={t(language, "dashboard.report.breaches")} value={data.counts.breached} tone="text-rose-600 dark:text-rose-400" />
            <Kpi label={t(language, "dashboard.report.emergency")} value={data.counts.emergency} />
          </div>
          {/* DEFERRED: opened-vs-closed and SLA-compliance trend charts go here once an
              AuditLog-derived weekly rollup exists. See plan §"Scope for v1". */}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ChartPie className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.riskMix")}</CardTitle></CardHeader>
          <CardContent><RiskDonut riskOpen={data.report.riskOpen} /></CardContent>
        </Card>
        <Card className="border-border/80 bg-card/90">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ChartBar className="h-4 w-4 text-primary" /> {t(language, "dashboard.monitor.openByOpco")}</CardTitle></CardHeader>
          <CardContent><OpcoBars data={data.report.opcoOpen} /></CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-card/90">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><LayoutGrid className="h-4 w-4 text-primary" /> {t(language, "dashboard.report.statusDistribution")}</CardTitle></CardHeader>
        <CardContent><StatusDistribution counts={data.report.statusCounts} /></CardContent>
      </Card>
    </div>
  )
}
