"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toaster"

export default function TeamsPage() {
  const { teams, addTeam } = useStore()
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const submit = () => {
    if (!name) {
      toast({ title: "Team name required", description: "Add a team name to continue.", variant: "error" })
      return
    }
    addTeam({ name, description: description || undefined })
    setName("")
    setDescription("")
    toast({ title: "Team created", description: `${name} is ready for assignments.`, variant: "success" })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle className="text-base">Teams</CardTitle>
          <CardDescription>Organize users into operational squads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {teams.length === 0 && <p className="text-sm text-slate-500">No teams created yet.</p>}
          {teams.map((team) => (
            <div key={team.id} className="rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium">{team.name}</div>
              {team.description && <p className="text-xs text-slate-500">{team.description}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle className="text-base">Create Team</CardTitle>
          <CardDescription>Use teams for routing and approvals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            placeholder="Team description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button onClick={submit}>Add Team</Button>
        </CardContent>
      </Card>
    </div>
  )
}
