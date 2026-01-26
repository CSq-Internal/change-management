"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const rules = [
  "Auto-assign approver by risk level",
  "Escalate approvals after 24 hours",
  "Notify security on high-risk changes",
  "Open Jira ticket when status is approved",
  "Post to Slack when changes are closed",
  "Schedule audit export on month end",
]

export default function AutomationPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.automation")}</h1>
        <p className="text-sm text-muted-foreground">Design rules that route and automate change workflows.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Automation Library</CardTitle>
          <CardDescription>Starter rules inspired by top operational teams.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {rules.map((rule) => (
            <div key={rule} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{rule}</div>
              <Button variant="outline" className="mt-3 h-8 px-3 text-xs">
                Configure
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
