"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const reports = [
  { label: "Change Lead Time", desc: "Average days from request to closure." },
  { label: "Approval SLA", desc: "Median approval time by risk level." },
  { label: "Success Rate", desc: "Verified vs failed changes." },
  { label: "Top Impacted Services", desc: "Most frequent change targets." },
]

export default function ReportsPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.reports")}</h1>
        <p className="text-sm text-muted-foreground">Analytics and KPI reporting.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Performance Reports</CardTitle>
          <CardDescription>Measure workflow health over time.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {reports.map((report) => (
            <div key={report.label} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{report.label}</div>
              <div className="text-xs text-muted-foreground">{report.desc}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
