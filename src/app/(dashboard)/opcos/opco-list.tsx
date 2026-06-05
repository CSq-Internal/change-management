"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbOpCo } from "./types"

interface OpcoListProps {
  opcos: DbOpCo[]
  language: Language
  onRename: (opco: DbOpCo) => void
  onArchiveToggle: (opco: DbOpCo) => void
}

export default function OpcoList({ opcos, language, onRename, onArchiveToggle }: OpcoListProps) {
  if (opcos.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "opcosAdmin.none")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">{t(language, "opcosAdmin.colName")}</th>
              <th className="px-4 py-2">{t(language, "opcosAdmin.colSlug")}</th>
              <th className="px-4 py-2">{t(language, "opcosAdmin.colStatus")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {opcos.map((o) => (
              <tr key={o.id} className="border-b border-border/40">
                <td className="px-4 py-2 font-medium">{o.name}</td>
                <td className="px-4 py-2">{o.slug}</td>
                <td className="px-4 py-2">
                  {t(language, o.archived ? "opcosAdmin.statusArchived" : "opcosAdmin.statusActive")}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onRename(o)}>
                      {t(language, "opcosAdmin.rename")}
                    </Button>
                    <Button variant="outline" onClick={() => onArchiveToggle(o)}>
                      {t(language, o.archived ? "opcosAdmin.unarchive" : "opcosAdmin.archive")}
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
