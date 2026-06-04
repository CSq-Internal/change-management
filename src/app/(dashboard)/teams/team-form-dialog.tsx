"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createTeam, updateTeam } from "@/server/actions/teams"
import type { DbTeam } from "./types"

interface TeamFormDialogProps {
  language: Language
  manageableSlugs: string[]
  team: DbTeam | null
  onClose: () => void
  onSaved: () => void
}

export default function TeamFormDialog({ language, manageableSlugs, team, onClose, onSaved }: TeamFormDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState(team?.name ?? "")
  const [description, setDescription] = useState(team?.description ?? "")
  const [opcoSlug, setOpcoSlug] = useState(team?.opco.slug ?? manageableSlugs[0] ?? "")
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setPending(true)
    try {
      if (team) {
        await updateTeam(team.id, { name, description })
      } else {
        await createTeam({ opcoSlug, name, description })
      }
      toast({ title: t(language, "teamsAdmin.saved"), description: name, variant: "success" })
      onSaved()
    } catch (err) {
      toast({ title: t(language, "teamsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">
            {t(language, team ? "teamsAdmin.editTitle" : "teamsAdmin.createTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!team && (
            <select
              aria-label={t(language, "teamsAdmin.fieldOpco")}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              value={opcoSlug}
              onChange={(e) => setOpcoSlug(e.target.value)}
            >
              {manageableSlugs.map((slug) => (
                <option key={slug} value={slug}>{slug}</option>
              ))}
            </select>
          )}
          <Input placeholder={t(language, "teamsAdmin.fieldName")} value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder={t(language, "teamsAdmin.fieldDesc")} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "teamsAdmin.cancel")}</Button>
            <Button onClick={save} disabled={pending || !name.trim()}>{t(language, "teamsAdmin.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
