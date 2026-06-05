"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbDelegation } from "./types"

interface DelegationListProps {
  delegations: DbDelegation[]
  language: Language
  onRevoke: (delegation: DbDelegation) => void
}

export default function DelegationList({ delegations, language, onRevoke }: DelegationListProps) {
  if (delegations.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "delegationsAdmin.none")}</p>
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
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colFrom")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colTo")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "delegationsAdmin.colUntil")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {delegations.map((d) => (
              <tr key={d.id} className="border-b border-border/40">
                <td className="px-4 py-2">{d.fromUser.email}</td>
                <td className="px-4 py-2">{d.toUser.email}</td>
                <td className="px-4 py-2">{d.opco.slug}</td>
                <td className="px-4 py-2">{new Date(d.validUntil).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => onRevoke(d)}>
                      {t(language, "delegationsAdmin.revoke")}
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
