"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
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

  return (
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
            <table className="w-full text-xs text-foreground/80">
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
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {entry.actor.name ?? entry.actor.email}
                    </td>
                    <td className="py-2 pr-4 max-w-[180px] truncate">{entry.change.title}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{entry.action}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{entry.change.opco.slug}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{entry.fromStatus ?? "—"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{entry.toStatus ?? "—"}</td>
                    <td className="py-2 max-w-[160px] truncate">{entry.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
