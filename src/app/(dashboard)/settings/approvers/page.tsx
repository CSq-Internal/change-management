"use client"

import { useState } from "react"
import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { AppUser } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function ApproverSettingsPage() {
  const { language } = useStore()
  // TODO: wire to server data (Phase 4)
  const users: AppUser[] = []
  const [defaultApproverIds, setDefaultApprovers] = useState<string[]>([])
  const approvers = users.filter((user) => user.permissions.includes("approve"))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.settingsApprovers")}</h1>
        <p className="text-sm text-muted-foreground">Configure default approvers for new requests.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Default Approvers</CardTitle>
          <CardDescription>Applied when a requester does not specify approvers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {approvers.length === 0 && <p className="text-sm text-muted-foreground">No approvers available.</p>}
          {approvers.map((user) => {
            const checked = defaultApproverIds.includes(user.id)
            return (
              <label key={user.id} className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setDefaultApprovers(
                      event.target.checked
                        ? [...defaultApproverIds, user.id]
                        : defaultApproverIds.filter((id) => id !== user.id)
                    )
                  }}
                />
                <span>{user.name}</span>
                <span className="text-xs text-muted-foreground">{user.email}</span>
              </label>
            )
          })}
          <Button variant="outline">Save</Button>
        </CardContent>
      </Card>
    </div>
  )
}
