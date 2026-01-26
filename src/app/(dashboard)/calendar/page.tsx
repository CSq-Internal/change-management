"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const placeholders = [
  { label: "Maintenance Window", date: "Wed 21:00 - 23:00" },
  { label: "Planned Network Upgrade", date: "Fri 02:00 - 04:00" },
  { label: "Blackout Period", date: "End of quarter" },
]

export default function CalendarPage() {
  const { language } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.calendar")}</h1>
        <p className="text-sm text-muted-foreground">Visualize change windows and operational constraints.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Upcoming Windows</CardTitle>
          <CardDescription>Schedule changes around approved maintenance slots.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {placeholders.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.date}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
