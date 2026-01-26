"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function AuditExportsPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.auditExports")}</h1>
        <p className="text-sm text-muted-foreground">Generate audit-ready exports by period and status.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Export Packs</CardTitle>
          <CardDescription>Select a template and generate evidence bundles.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {["ISO 27001", "SOC 2", "Internal Audit", "Quarterly Review", "Executive Summary", "Change Logs"].map(
            (pack) => (
              <div key={pack} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
                <div className="text-sm font-medium text-foreground">{pack}</div>
                <Button variant="outline" className="mt-3 h-8 px-3 text-xs">
                  Generate
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}
