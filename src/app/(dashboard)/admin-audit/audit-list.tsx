"use client"

import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { AuditRow } from "./types"

interface AuditListProps {
  rows: AuditRow[]
  language: Language
}

export default function AuditList({ rows, language }: AuditListProps) {
  if (rows.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "auditAdmin.none")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
        <table className="responsive-table w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">{t(language, "auditAdmin.colWhen")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colActor")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colAction")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "auditAdmin.colSummary")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 align-top">
                <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground" data-label={t(language, "auditAdmin.colWhen")}>
                  {new Date(r.at).toLocaleString()}
                </td>
                <td className="px-4 py-2" data-label={t(language, "auditAdmin.colActor")}>{r.actorEmail}</td>
                <td className="px-4 py-2 font-mono text-xs" data-label={t(language, "auditAdmin.colAction")}>{r.action}</td>
                <td className="px-4 py-2" data-label={t(language, "auditAdmin.colOpco")}>{r.opcoSlug ?? "—"}</td>
                <td className="px-4 py-2" data-label={t(language, "auditAdmin.colSummary")}>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </CardContent>
    </Card>
  )
}
