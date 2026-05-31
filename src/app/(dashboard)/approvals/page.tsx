"use client"

import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import type { ChangeRequest } from "@/lib/types"

export default function Approvals() {
  const { language } = useStore()
  const { data: session } = useSession()
  const currentUser = session?.user ?? null
  // TODO: wire to server data (Phase 4)
  const changes: ChangeRequest[] = []
  const update = (_id: string, _patch: Partial<ChangeRequest>) => {}
  const { toast } = useToast()
  const pending = currentUser
    ? changes.filter(
        (c) =>
          c.status === "pending" &&
          (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
      )
    : []
  // TODO: wire to server roles (Phase 4)
  const canApprove = true

  if (!currentUser) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "approvals.signIn")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t(language, "approvals.signInDesc")}</p>
        </CardContent>
      </Card>
    )
  }

  if (!canApprove) {
    return (
      <Card className="border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "approvals.accessRequired")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t(language, "approvals.accessDesc")}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      {pending.map((c) => (
        <Card key={c.id} className="border-border/80 bg-card/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-base line-clamp-2 sm:line-clamp-1">{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{c.description}</p>
            <div className="mt-2 text-xs text-muted-foreground">
              {t(language, "approvals.requestedBy")} {c.requester} • {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => {
                  update(c.id, { status: "approved" })
                  toast({
                    title: t(language, "approvals.toast.approved"),
                    description: t(language, "approvals.toast.approvedDesc"),
                    variant: "success",
                  })
                }}
                variant="default"
                className="w-full sm:w-auto"
              >
                {t(language, "approvals.approve")}
              </Button>
              <Button
                onClick={() => {
                  update(c.id, { status: "rejected" })
                  toast({
                    title: t(language, "approvals.toast.rejected"),
                    description: t(language, "approvals.toast.rejectedDesc"),
                    variant: "error",
                  })
                }}
                variant="destructive"
                className="w-full sm:w-auto"
              >
                {t(language, "approvals.reject")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {pending.length === 0 && <p className="text-sm text-muted-foreground">{t(language, "approvals.none")}</p>}
    </div>
  )
}
