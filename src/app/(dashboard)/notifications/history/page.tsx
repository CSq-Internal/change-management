"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const history = [
  { channel: "Email", detail: "Approval request sent to approvers.", time: "10 mins ago" },
  { channel: "Teams", detail: "Change implemented notification posted.", time: "1 hour ago" },
  { channel: "SMS", detail: "High-risk change reminder delivered.", time: "Today" },
  { channel: "Webhook", detail: "Audit export webhook triggered.", time: "Yesterday" },
]

export default function NotificationHistoryPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.notificationHistory")}</h1>
        <p className="text-sm text-muted-foreground">Audit trail of alerts across all channels.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Delivery Log</CardTitle>
          <CardDescription>Monitor notification delivery status.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {history.map((item) => (
            <div key={item.detail} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">
                {item.channel} • {item.time}
              </div>
              <div className="text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
