"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function AuditExportsPage() {
  const { language } = useStore()
  const [opco, setOpco] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  function handleDownload() {
    const p = new URLSearchParams()
    if (opco) p.set("opco", opco)
    if (from) p.set("from", from)
    if (to) p.set("to", to)
    window.location.href = `/api/audit-export?${p}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.auditExports")}</h1>
        <p className="text-sm text-muted-foreground">Generate audit-ready exports by period and status.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">CSV Export</CardTitle>
          <CardDescription>Filter by OpCo and date range, then download the audit log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="opco" className="text-sm font-medium">OpCo (leave blank for all)</label>
              <Input
                id="opco"
                placeholder="e.g. ghana"
                value={opco}
                onChange={(e) => setOpco(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="from" className="text-sm font-medium">From</label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="to" className="text-sm font-medium">To</label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={handleDownload}>Download CSV</Button>
        </CardContent>
      </Card>
    </div>
  )
}
