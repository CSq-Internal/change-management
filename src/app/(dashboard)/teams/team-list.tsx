"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { t, type Language } from "@/lib/i18n"
import type { DbTeam } from "./types"

interface TeamListProps {
  teams: DbTeam[]
  language: Language
  onEdit: (team: DbTeam) => void
  onMembers: (team: DbTeam) => void
  onDelete: (team: DbTeam) => void
}

export default function TeamList({ teams, language, onEdit, onMembers, onDelete }: TeamListProps) {
  if (teams.length === 0) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.none")}</p>
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
              <th className="px-4 py-2">{t(language, "teamsAdmin.colName")}</th>
              <th className="px-4 py-2">{t(language, "teamsAdmin.colOpco")}</th>
              <th className="px-4 py-2">{t(language, "teamsAdmin.colMembers")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="border-b border-border/40">
                <td className="px-4 py-2" data-label={t(language, "teamsAdmin.colName")}>
                  <div className="font-medium">{team.name}</div>
                  {team.description && (
                    <div className="text-xs text-muted-foreground">{team.description}</div>
                  )}
                </td>
                <td className="px-4 py-2" data-label={t(language, "teamsAdmin.colOpco")}>{team.opco.slug}</td>
                <td className="px-4 py-2" data-label={t(language, "teamsAdmin.colMembers")}>{team.members.length}</td>
                <td className="px-4 py-2" data-label="">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onMembers(team)}>
                      {t(language, "teamsAdmin.members")}
                    </Button>
                    <Button variant="outline" onClick={() => onEdit(team)}>
                      {t(language, "teamsAdmin.edit")}
                    </Button>
                    <Button variant="outline" onClick={() => onDelete(team)}>
                      {t(language, "teamsAdmin.delete")}
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
