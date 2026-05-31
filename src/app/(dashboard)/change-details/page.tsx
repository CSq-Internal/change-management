"use client"

import { useStore } from "@/lib/store"
import { t } from "@/lib/i18n"
import type { ChangeRequest } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ChangeDetailsPage() {
  const { language } = useStore()
  // TODO: wire to server data (Phase 4)
  const changes: ChangeRequest[] = []
  const latest = changes[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(language, "nav.changeDetails")}</h1>
        <p className="text-sm text-muted-foreground">Deep dive into a single change request and its audit trail.</p>
      </div>

      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">Latest Request Snapshot</CardTitle>
          <CardDescription>Use the change list to navigate to a specific request.</CardDescription>
        </CardHeader>
        <CardContent>
          {latest ? (
            <div className="space-y-2 text-sm">
              <div className="font-medium">{latest.title}</div>
              <div className="text-muted-foreground">{latest.description}</div>
              <div className="text-xs text-muted-foreground">
                Status: {latest.status} • Updated {new Date(latest.updatedAt).toLocaleString()}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No changes created yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
