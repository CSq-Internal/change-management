"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { CabMember } from "./types"

interface CabTableProps {
  members: CabMember[]
  language: Language
  showOpco: boolean
  onRemove: (member: CabMember) => void
}

export default function CabTable({ members, language, showOpco, onRemove }: CabTableProps) {
  if (members.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "cabAdmin.none")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <CardContent className="p-0">
        <table className="responsive-table w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">{t(language, "cabAdmin.colMember")}</th>
              {showOpco && <th className="px-4 py-2">{t(language, "cabAdmin.colOpco")}</th>}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/40">
                <td className="px-4 py-2" data-label={t(language, "cabAdmin.colMember")}>{m.email}</td>
                {showOpco && <td className="px-4 py-2" data-label={t(language, "cabAdmin.colOpco")}>{m.opco?.slug ?? "—"}</td>}
                <td className="px-4 py-2" data-label="">
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => onRemove(m)}>
                      {t(language, "cabAdmin.remove")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
