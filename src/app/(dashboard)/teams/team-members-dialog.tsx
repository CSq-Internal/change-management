"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { addTeamMember, removeTeamMember, setTeamMemberRole, listOpCoMembers } from "@/server/actions/teams"
import type { DbTeam, OpCoMember } from "./types"

interface TeamMembersDialogProps {
  language: Language
  team: DbTeam
  onClose: () => void
  onChanged: () => void
}

export default function TeamMembersDialog({ language, team, onClose, onChanged }: TeamMembersDialogProps) {
  const { toast } = useToast()
  const [candidates, setCandidates] = useState<OpCoMember[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    listOpCoMembers(team.opco.slug).then(setCandidates).catch(() => setCandidates([]))
  }, [team.opco.slug])

  const memberIds = new Set(team.members.map((m) => m.userId))
  const addable = candidates.filter((c) => !memberIds.has(c.id))

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true)
    try {
      await fn()
      onChanged()
    } catch (err) {
      toast({ title: t(language, "teamsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-lg border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "teamsAdmin.membersTitle")} — {team.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {team.members.length === 0 && (
              <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.noMembers")}</p>
            )}
            {team.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded border border-border/60 px-3 py-2 text-sm">
                <div>
                  <div>{m.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(language, m.role === "lead" ? "teamsAdmin.roleLead" : "teamsAdmin.roleMember")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => run(() => setTeamMemberRole(team.id, m.userId, m.role === "lead" ? "member" : "lead"))} disabled={pending}>
                    {t(language, m.role === "lead" ? "teamsAdmin.makeMember" : "teamsAdmin.makeLead")}
                  </Button>
                  <Button variant="outline" onClick={() => run(() => removeTeamMember(team.id, m.userId))} disabled={pending}>
                    {t(language, "teamsAdmin.remove")}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs text-muted-foreground">{t(language, "teamsAdmin.pickMember")}</div>
            <div className="space-y-1">
              {addable.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded border border-border/40 px-3 py-1.5 text-sm">
                  <span>{c.email}</span>
                  <Button variant="outline" onClick={() => run(() => addTeamMember(team.id, c.id, "member"))} disabled={pending}>
                    {t(language, "teamsAdmin.addMember")}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "teamsAdmin.cancel")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
