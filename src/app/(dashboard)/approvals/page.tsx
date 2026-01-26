"use client"

import { useStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"

export default function Approvals() {
  const { changes, update, currentUser, role, language } = useStore()
  const { toast } = useToast()
  const pending = currentUser
    ? changes.filter(
        (c) =>
          c.status === "pending" &&
          (c.assignees.length === 0 || c.assignees.includes(currentUser.id))
      )
    : []
  const canApprove = role === "approver" || role === "admin"

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
            <CardTitle className="text-base">{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{c.description}</p>
            <div className="mt-2 text-xs text-muted-foreground">
              {t(language, "approvals.requestedBy")} {c.requester} • {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="mt-3 flex gap-2">
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
