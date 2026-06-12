"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { SlaReportCell } from "@/lib/sla-report"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type StatusCount = { status: string; count: number }
type RiskCount = { riskLevel: string; count: number }

export type ReportsData = {
  byStatus: StatusCount[]
  byRisk: RiskCount[]
  changes: {
    id: string
    title: string
    status: string
    riskLevel: string
    createdAt: Date
    updatedAt: Date
  }[]
  slaCompliance: SlaReportCell[]
}

const reportCards = [
  { key: "reports.card.leadTime", descKey: "reports.card.leadTimeDesc" },
  { key: "reports.card.approvalSla", descKey: "reports.card.approvalSlaDesc" },
  { key: "reports.card.successRate", descKey: "reports.card.successRateDesc" },
  { key: "reports.card.topServices", descKey: "reports.card.topServicesDesc" },
]

const slaTargets = [
  { label: "Low risk approvals", targetHours: 48 },
  { label: "Medium risk approvals", targetHours: 24 },
  { label: "High risk approvals", targetHours: 4 },
  { label: "Change closure", targetHours: 72 },
]

interface ReportsClientProps {
  data: ReportsData
}

export default function ReportsClient({ data }: ReportsClientProps) {
  const { language } = useStore()
  const { changes } = data

  const closed = changes.filter((c) => c.status === "closed")
  const approved = changes.filter((c) =>
    ["approved", "implemented", "verified", "closed"].includes(c.status)
  )
  const verified = changes.filter((c) => c.status === "verified")

  const avgLeadTimeHours =
    closed.length === 0
      ? 0
      : closed.reduce(
          (sum, c) =>
            sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) / 36e5,
          0
        ) / closed.length

  const approvalTimeHours =
    approved.length === 0
      ? 0
      : approved.reduce(
          (sum, c) =>
            sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) / 36e5,
          0
        ) / approved.length

  const successRate =
    approved.length === 0 ? 0 : Math.round((verified.length / approved.length) * 100)

  const kpis = [
    { labelKey: "reports.kpi.leadTime", value: `${avgLeadTimeHours.toFixed(1)}h` },
    { labelKey: "reports.kpi.approvalTime", value: `${approvalTimeHours.toFixed(1)}h` },
    { labelKey: "reports.kpi.successRate", value: `${successRate}%` },
    { labelKey: "reports.kpi.totalChanges", value: String(changes.length) },
  ]

  const exportCsv = () => {
    const rows = [
      ["id", "title", "status", "riskLevel", "createdAt", "updatedAt"],
      ...changes.map((c) => [
        c.id,
        c.title,
        c.status,
        c.riskLevel,
        new Date(c.createdAt).toISOString(),
        new Date(c.updatedAt).toISOString(),
      ]),
    ]
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
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

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "reports.slaComplianceTitle")}</CardTitle>
          <CardDescription>{t(language, "reports.slaComplianceDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.slaCompliance.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(language, "reports.slaCompliance.empty")}</p>
          ) : (
            <table className="responsive-table w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t(language, "reports.slaCol.opco")}</th>
                  <th className="py-2 pr-4 font-medium">{t(language, "reports.slaCol.risk")}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t(language, "reports.slaCol.decided")}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t(language, "reports.slaCol.inSla")}</th>
                  <th className="py-2 font-medium text-right">{t(language, "reports.slaCol.adherence")}</th>
                </tr>
              </thead>
              <tbody>
                {data.slaCompliance.map((cell) => (
                  <tr key={`${cell.opcoSlug}-${cell.riskLevel}`} className="border-b border-border/40">
                    <td className="py-2 pr-4" data-label={t(language, "reports.slaCol.opco")}>{cell.opcoName}</td>
                    <td className="py-2 pr-4 capitalize" data-label={t(language, "reports.slaCol.risk")}>{cell.riskLevel}</td>
                    <td className="py-2 pr-4 text-right" data-label={t(language, "reports.slaCol.decided")}>{cell.decided}</td>
                    <td className="py-2 pr-4 text-right" data-label={t(language, "reports.slaCol.inSla")}>{cell.inSla}</td>
                    <td className="py-2 text-right font-medium" data-label={t(language, "reports.slaCol.adherence")}>
                      {cell.adherencePct == null ? "—" : `${cell.adherencePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
