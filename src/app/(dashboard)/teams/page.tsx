"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageUsers } from "@/lib/permissions"
import type { Team } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"

export default function TeamsPage() {
  const { language } = useStore()
  const { data: session } = useSession()
  // TODO: wire to server data (Phase 4)
  const teams: Team[] = []
  const addTeam = (_team: Omit<Team, "id" | "createdAt">) => {}
  const isAdmin = session
    ? canManageUsers(
        session.user.organizations,
        session.user.realmRoles,
        session.user.organizations[0]?.alias ?? ""
      )
    : false
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [planSummary, setPlanSummary] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])

  const submit = () => {
    if (!isAdmin) {
      toast({
        title: t(language, "teams.adminOnly"),
        description: t(language, "teams.adminOnlyDesc"),
        variant: "error",
      })
      return
    }
    if (!name) {
      toast({
        title: t(language, "teams.toast.nameRequired"),
        description: t(language, "teams.toast.nameRequiredDesc"),
        variant: "error",
      })
      return
    }
    addTeam({
      name,
      description: description || undefined,
      planSummary: planSummary || undefined,
      attachments: attachments.map((file) => ({
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    })
    setName("")
    setDescription("")
    setPlanSummary("")
    setAttachments([])
    toast({ title: t(language, "teams.toast.created"), description: name, variant: "success" })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "teams.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "teams.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "teams.title")}</CardTitle>
          <CardDescription>{t(language, "teams.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {teams.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "teams.none")}</p>}
          {teams.map((team) => (
            <div key={team.id} className="rounded-xl border border-border/70 bg-muted px-4 py-3">
              <div className="text-sm font-medium">{team.name}</div>
              {team.description && <p className="text-xs text-muted-foreground">{team.description}</p>}
              {team.planSummary && <p className="mt-2 text-xs text-muted-foreground">{team.planSummary}</p>}
              {team.attachments && team.attachments.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Attachments: {team.attachments.map((file) => file.name).join(", ")}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "teams.createTitle")}</CardTitle>
          <CardDescription>{t(language, "teams.createDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={t(language, "teams.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            placeholder={t(language, "teams.descField")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Textarea
            placeholder="Plan summary for the team"
            value={planSummary}
            onChange={(e) => setPlanSummary(e.target.value)}
          />
          <input
            type="file"
            multiple
            className="block w-full text-xs text-muted-foreground"
            onChange={(event) => {
              setAttachments(Array.from(event.target.files ?? []))
            }}
          />
          <Button onClick={submit} disabled={!isAdmin}>
            {t(language, "teams.add")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
