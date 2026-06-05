"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, manageableOpCoSlugs } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { revokeDelegation } from "@/server/actions/delegations"
import ConfirmDialog from "../users/confirm-dialog"
import DelegationList from "./delegation-list"
import DelegationCreateDialog from "./delegation-create-dialog"
import type { DbDelegation } from "./types"

interface DelegationsClientProps {
  delegations: DbDelegation[]
}

export default function DelegationsClient({ delegations }: DelegationsClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isAdmin = session ? canManageAnyOpCo(session.user.organizations, session.user.realmRoles) : false
  const scope = session ? manageableOpCoSlugs(session.user.organizations, session.user.realmRoles) : []
  const manageableSlugs =
    scope === "all" ? Array.from(new Set(delegations.map((d) => d.opco.slug).filter(Boolean))) : scope

  const [createOpen, setCreateOpen] = useState(false)
  const [confirm, setConfirm] = useState<DbDelegation | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const handleRevoke = async () => {
    if (!confirm) return
    setPending(true)
    try {
      await revokeDelegation(confirm.id)
      toast({ title: t(language, "delegationsAdmin.revoked"), variant: "success" })
      setConfirm(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "delegationsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "delegationsAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "delegationsAdmin.desc")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!isAdmin || manageableSlugs.length === 0}>
          {t(language, "delegationsAdmin.new")}
        </Button>
      </div>

      <DelegationList delegations={delegations} language={language} onRevoke={(d) => setConfirm(d)} />

      {createOpen && (
        <DelegationCreateDialog
          language={language}
          manageableSlugs={manageableSlugs}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); refresh() }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={t(language, "delegationsAdmin.revokeTitle")}
          body={t(language, "delegationsAdmin.revokeBody")}
          confirmLabel={t(language, "delegationsAdmin.revoke")}
          cancelLabel={t(language, "delegationsAdmin.cancel")}
          pending={pending}
          onConfirm={handleRevoke}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
