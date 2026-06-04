"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { deleteTeam } from "@/server/actions/teams"
import ConfirmDialog from "../users/confirm-dialog"
import TeamList from "./team-list"
import TeamFormDialog from "./team-form-dialog"
import TeamMembersDialog from "./team-members-dialog"
import type { DbTeam } from "./types"

interface TeamsClientProps {
  teams: DbTeam[]
}

export default function TeamsClient({ teams }: TeamsClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
  const scope = session
    ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
    : []
  const manageableSlugs =
    scope === "all" ? Array.from(new Set(teams.map((tm) => tm.opco.slug))) : scope

  const [formTeam, setFormTeam] = useState<DbTeam | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [membersTeam, setMembersTeam] = useState<DbTeam | null>(null)
  const [confirmTeam, setConfirmTeam] = useState<DbTeam | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const handleDelete = async () => {
    if (!confirmTeam) return
    setPending(true)
    try {
      await deleteTeam(confirmTeam.id)
      toast({ title: t(language, "teamsAdmin.deleted"), description: confirmTeam.name, variant: "success" })
      setConfirmTeam(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "teamsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "teams.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "teams.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "teamsAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "teamsAdmin.desc")}</p>
        </div>
        <Button onClick={() => { setFormTeam(null); setFormOpen(true) }} disabled={!isAdmin || manageableSlugs.length === 0}>
          {t(language, "teamsAdmin.new")}
        </Button>
      </div>

      <TeamList
        teams={teams}
        language={language}
        onEdit={(team) => { setFormTeam(team); setFormOpen(true) }}
        onMembers={(team) => setMembersTeam(team)}
        onDelete={(team) => setConfirmTeam(team)}
      />

      {formOpen && (
        <TeamFormDialog
          language={language}
          manageableSlugs={manageableSlugs}
          team={formTeam}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refresh() }}
        />
      )}

      {membersTeam && (
        <TeamMembersDialog
          language={language}
          team={membersTeam}
          onClose={() => setMembersTeam(null)}
          onChanged={refresh}
        />
      )}

      {confirmTeam && (
        <ConfirmDialog
          title={t(language, "teamsAdmin.deleteTitle")}
          body={t(language, "teamsAdmin.deleteBody")}
          confirmLabel={t(language, "teamsAdmin.delete")}
          cancelLabel={t(language, "teamsAdmin.cancel")}
          pending={pending}
          onConfirm={handleDelete}
          onCancel={() => setConfirmTeam(null)}
        />
      )}
    </div>
  )
}
