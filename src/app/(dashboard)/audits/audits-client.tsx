"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"

export type AuditEntry = {
  id: string
  at: Date
  action: string
  fromStatus: string | null
  toStatus: string | null
  note: string | null
  actor: { name: string | null; email: string }
  change: {
    title: string
    opco: { slug: string }
  }
}

interface AuditsClientProps {
  entries: AuditEntry[]
}

export default function AuditsClient({ entries }: AuditsClientProps) {
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
    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-base">CSV Export</CardTitle>
        <CardDescription>Filter by OpCo and date range, then download the audit log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="opco" className="text-sm font-medium">OpCo (leave blank for all)</label>
            <Input id="opco" placeholder="e.g. ghana" value={opco} onChange={(e) => setOpco(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="from" className="text-sm font-medium">From</label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="to" className="text-sm font-medium">To</label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleDownload}>Download CSV</Button>
      </CardContent>
    </Card>

    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-xl sm:text-lg">{t(language, "audits.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t(language, "audits.desc")}</p>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No audit entries found.</p>
        ) : (
          <div className="mt-4 overflow-auto max-h-[60vh] sm:max-h-[50vh]">
            <table className="responsive-table w-full text-xs text-foreground/80">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Timestamp</th>
                  <th className="pb-2 pr-4">Actor</th>
                  <th className="pb-2 pr-4">Change</th>
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">OpCo</th>
                  <th className="pb-2 pr-4">From</th>
                  <th className="pb-2 pr-4">To</th>
                  <th className="pb-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="Timestamp">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="Actor">
                      {entry.actor.name ?? entry.actor.email}
                    </td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" data-label="Change">{entry.change.title}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="Action">{entry.action}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="OpCo">{entry.change.opco.slug}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="From">{entry.fromStatus ?? "—"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label="To">{entry.toStatus ?? "—"}</td>
                    <td className="py-2 max-w-[160px] truncate" data-label="Note">{entry.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  )
}
