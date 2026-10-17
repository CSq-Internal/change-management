"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import { DateTime } from "@/components/date-time"

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
        <CardTitle className="text-base">{t(language, "audits.export.title")}</CardTitle>
        <CardDescription>{t(language, "audits.export.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="opco" className="text-sm font-medium">{t(language, "audits.export.opco")}</label>
            <Input id="opco" placeholder={t(language, "audits.export.opcoPlaceholder")} value={opco} onChange={(e) => setOpco(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="from" className="text-sm font-medium">{t(language, "auditAdmin.filterFrom")}</label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="to" className="text-sm font-medium">{t(language, "auditAdmin.filterTo")}</label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleDownload}>{t(language, "audits.export.download")}</Button>
      </CardContent>
    </Card>

    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-xl sm:text-lg">{t(language, "audits.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t(language, "audits.desc")}</p>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t(language, "audits.empty")}</p>
        ) : (
          <div className="mt-4 overflow-auto max-h-[60vh] sm:max-h-[50vh]">
            <table className="responsive-table w-full text-xs text-foreground/80">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4">{t(language, "audits.col.timestamp")}</th>
                  <th className="pb-2 pr-4">{t(language, "auditAdmin.colActor")}</th>
                  <th className="pb-2 pr-4">{t(language, "audits.col.change")}</th>
                  <th className="pb-2 pr-4">{t(language, "auditAdmin.colAction")}</th>
                  <th className="pb-2 pr-4">{t(language, "auditAdmin.colOpco")}</th>
                  <th className="pb-2 pr-4">{t(language, "audits.col.from")}</th>
                  <th className="pb-2 pr-4">{t(language, "audits.col.to")}</th>
                  <th className="pb-2">{t(language, "audits.col.note")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "audits.col.timestamp")}>
                      <DateTime value={entry.at} />
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "auditAdmin.colActor")}>
                      {entry.actor.name ?? entry.actor.email}
                    </td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" data-label={t(language, "audits.col.change")}>{entry.change.title}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "auditAdmin.colAction")}>{entry.action}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "auditAdmin.colOpco")}>{entry.change.opco.slug}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "audits.col.from")}>{entry.fromStatus ?? "—"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap" data-label={t(language, "audits.col.to")}>{entry.toStatus ?? "—"}</td>
                    <td className="py-2 max-w-[160px] truncate" data-label={t(language, "audits.col.note")}>{entry.note ?? "—"}</td>
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
