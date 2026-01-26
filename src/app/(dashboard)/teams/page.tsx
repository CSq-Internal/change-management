"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"

export default function TeamsPage() {
  const { teams, addTeam, currentUser, language } = useStore()
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const submit = () => {
    if (!currentUser?.permissions.includes("admin")) {
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
    addTeam({ name, description: description || undefined })
    setName("")
    setDescription("")
    toast({ title: t(language, "teams.toast.created"), description: name, variant: "success" })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {!currentUser?.permissions.includes("admin") && (
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
          <Button onClick={submit} disabled={!currentUser?.permissions.includes("admin")}>
            {t(language, "teams.add")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
