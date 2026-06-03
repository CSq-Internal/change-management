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
import { deactivateUser, reactivateUser } from "@/server/actions/users"
import type { DbUser } from "./types"
import UserList from "./user-list"
import OnboardWizard from "./onboard-wizard"
import EditUserDialog from "./edit-user-dialog"
import ConfirmDialog from "./confirm-dialog"

interface UsersClientProps {
  users: DbUser[]
}

export default function UsersClient({ users }: UsersClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session
    ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles)
    : false
  const manageable = session
    ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
    : []

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editUser, setEditUser] = useState<DbUser | null>(null)
  const [confirmUser, setConfirmUser] = useState<DbUser | null>(null)
  const [pending, setPending] = useState(false)

  const handleDeactivate = async () => {
    if (!confirmUser) return
    setPending(true)
    try {
      await deactivateUser(confirmUser.id)
      toast({
        title: t(language, "users.toast.deactivated"),
        description: confirmUser.email,
        variant: "success",
      })
      setConfirmUser(null)
      router.refresh()
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  const handleReactivate = async (user: DbUser) => {
    try {
      await reactivateUser(user.id)
      toast({
        title: t(language, "users.toast.reactivated"),
        description: user.email,
        variant: "success",
      })
      router.refresh()
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      })
    }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Card className="border-border/80 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">{t(language, "users.adminOnly")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t(language, "users.adminOnlyDesc")}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "users.desc")}</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} disabled={!isAdmin}>
          {t(language, "users.onboard")}
        </Button>
      </div>

      <UserList
        users={users}
        isAdmin={isAdmin}
        language={language}
        onEdit={(u) => setEditUser(u)}
        onDeactivate={(u) => setConfirmUser(u)}
        onReactivate={handleReactivate}
      />

      {wizardOpen && (
        <OnboardWizard
          language={language}
          manageable={manageable}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false)
            router.refresh()
          }}
        />
      )}

      {editUser && (
        <EditUserDialog
          user={editUser}
          language={language}
          manageable={manageable}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null)
            router.refresh()
          }}
        />
      )}

      {confirmUser && (
        <ConfirmDialog
          title={t(language, "users.confirm.deactivateTitle")}
          body={t(language, "users.confirm.deactivateBody")}
          confirmLabel={t(language, "users.confirm.confirm")}
          cancelLabel={t(language, "users.confirm.cancel")}
          pending={pending}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmUser(null)}
        />
      )}
    </div>
  )
}
