"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const riskItems = [
  { label: "Change collisions", level: "High", owner: "Change Advisory Board" },
  { label: "Unplanned downtime", level: "Medium", owner: "Ops" },
  { label: "Security drift", level: "High", owner: "Security" },
  { label: "Rollback complexity", level: "Low", owner: "Engineering" },
]

export default function RiskRegisterPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.riskRegister")}</h1>
        <p className="text-sm text-muted-foreground">Track systemic risks and mitigation plans.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Open Risks</CardTitle>
          <CardDescription>Review risk owners and mitigation progress.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {riskItems.map((risk) => (
            <div key={risk.label} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{risk.label}</div>
              <div className="text-xs text-muted-foreground">
                Level: {risk.level} • Owner: {risk.owner}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
