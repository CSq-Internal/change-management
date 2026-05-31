"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type Change = {
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  riskLevel?: string
  requester?: string
}

const reportCards = [
  { key: "reports.card.leadTime", descKey: "reports.card.leadTimeDesc" },
  { key: "reports.card.approvalSla", descKey: "reports.card.approvalSlaDesc" },
  { key: "reports.card.successRate", descKey: "reports.card.successRateDesc" },
  { key: "reports.card.topServices", descKey: "reports.card.topServicesDesc" },
]

export default function ReportsPage() {
  const { language } = useStore()
  // TODO: wire to server data (Phase 4)
  const typedChanges: Change[] = []

  const closed = typedChanges.filter((c) => c.status === "closed")
  const approved = typedChanges.filter((c) => ["approved", "implemented", "verified", "closed"].includes(c.status))
  const verified = typedChanges.filter((c) => c.status === "verified")

  const avgLeadTimeHours =
    closed.length === 0
      ? 0
      : closed.reduce((sum, c) => sum + (Date.parse(c.updatedAt) - Date.parse(c.createdAt)) / 36e5, 0) / closed.length

  const approvalTimeHours =
    approved.length === 0
      ? 0
      : approved.reduce((sum, c) => sum + (Date.parse(c.updatedAt) - Date.parse(c.createdAt)) / 36e5, 0) /
        approved.length

  const successRate = approved.length === 0 ? 0 : Math.round((verified.length / approved.length) * 100)

  const kpis = [
    { labelKey: "reports.kpi.leadTime", value: `${avgLeadTimeHours.toFixed(1)}h` },
    { labelKey: "reports.kpi.approvalTime", value: `${approvalTimeHours.toFixed(1)}h` },
    { labelKey: "reports.kpi.successRate", value: `${successRate}%` },
    { labelKey: "reports.kpi.totalChanges", value: String(typedChanges.length) },
  ]

  const slaTargets = [
    { label: "Low risk approvals", targetHours: 48 },
    { label: "Medium risk approvals", targetHours: 24 },
    { label: "High risk approvals", targetHours: 4 },
    { label: "Change closure", targetHours: 72 },
  ]

  const exportCsv = () => {
    const rows = [
      ["id", "title", "status", "riskLevel", "requester", "createdAt", "updatedAt"],
      ...typedChanges.map((c) => [
        c.id,
        c.title,
        c.status,
        c.riskLevel ?? "",
        c.requester ?? "",
        c.createdAt,
        c.updatedAt,
      ]),
    ]
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/\"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "change-reports.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    window.print()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.reports")}</h1>
        <p className="text-sm text-muted-foreground">{t(language, "reports.subtitle")}</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.kpiTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.kpiDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.labelKey} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-xs text-muted-foreground">{t(language, kpi.labelKey)}</div>
              <div className="text-lg font-semibold text-foreground">{kpi.value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.slaTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.slaDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {slaTargets.map((sla) => (
            <div key={sla.label} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{sla.label}</div>
              <div className="text-xs text-muted-foreground">Target: {sla.targetHours}h</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.exportTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.exportDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={exportCsv} variant="outline">
            {t(language, "reports.exportCsv")}
          </Button>
          <Button onClick={exportPdf} variant="outline">
            {t(language, "reports.exportPdf")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.performanceTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.performanceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {reportCards.map((report) => (
            <div key={report.key} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{t(language, report.key)}</div>
              <div className="text-xs text-muted-foreground">{t(language, report.descKey)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
