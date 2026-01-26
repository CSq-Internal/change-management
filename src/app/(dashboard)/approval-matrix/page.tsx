"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const matrix = [
  { role: "Requester", approvals: "Low risk changes", sla: "24h" },
  { role: "Approver", approvals: "Medium risk changes", sla: "48h" },
  { role: "Admin", approvals: "High risk + emergency", sla: "4h" },
  { role: "Auditor", approvals: "Post-change review", sla: "72h" },
]

export default function ApprovalMatrixPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.approvalMatrix")}</h1>
        <p className="text-sm text-muted-foreground">Define who approves what and expected SLAs.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Approval Matrix</CardTitle>
          <CardDescription>Align risk level with approval roles.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {matrix.map((row) => (
            <div key={row.role} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{row.role}</div>
              <div className="text-xs text-muted-foreground">
                Scope: {row.approvals} • SLA: {row.sla}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
