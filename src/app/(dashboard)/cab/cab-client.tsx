"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useStore } from "@/lib/store"
import { isGroupAdmin } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { removeCabMember } from "@/server/actions/cab"
import ConfirmDialog from "../users/confirm-dialog"
import CabTable from "./cab-table"
import CabAddDialog from "./cab-add-dialog"
import type { CabMember } from "./types"

interface CabClientProps {
  perOpco: CabMember[]
  group: CabMember[]
  showGroup: boolean
  manageableOpcos: { slug: string; name: string }[]
}

export default function CabClient({ perOpco, group, showGroup, manageableOpcos }: CabClientProps) {
  const { language } = useStore()
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()

  const isGroupAdminUser = session ? isGroupAdmin(session.user.realmRoles) : false

  const [tab, setTab] = useState<"perOpco" | "group">("perOpco")
  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<CabMember | null>(null)
  const [pending, setPending] = useState(false)

  const activeMembers = tab === "group" ? group : perOpco
  // Group CAB add is group_admin-only server-side; per-OpCo add needs ≥1 manageable OpCo.
  const addDisabled = tab === "group" ? !isGroupAdminUser : manageableOpcos.length === 0

  const refresh = () => router.refresh()

  const handleRemove = async () => {
    if (!confirm) return
    setPending(true)
    try {
      await removeCabMember(confirm.userId, confirm.opco?.slug ?? null)
      toast({ title: t(language, "cabAdmin.removed"), description: confirm.email, variant: "success" })
      setConfirm(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "cabAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "cabAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "cabAdmin.desc")}</p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={addDisabled}>
          {t(language, "cabAdmin.add")}
        </Button>
      </div>

      <div className="flex gap-2 text-sm">
        <Button variant={tab === "perOpco" ? "default" : "outline"} onClick={() => setTab("perOpco")}>
          {t(language, "cabAdmin.tabPerOpco")}
        </Button>
        {showGroup && (
          <Button variant={tab === "group" ? "default" : "outline"} onClick={() => setTab("group")}>
            {t(language, "cabAdmin.tabGroup")}
          </Button>
        )}
      </div>

      <CabTable members={activeMembers} language={language} showOpco={tab === "perOpco"} onRemove={(m) => setConfirm(m)} />

      {addOpen && (
        <CabAddDialog
          language={language}
          opcos={tab === "group" ? null : manageableOpcos}
          existing={activeMembers.map((m) => ({ userId: m.userId, opcoSlug: m.opco?.slug ?? null }))}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); refresh() }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={t(language, "cabAdmin.removeTitle")}
          body={t(language, "cabAdmin.removeBody")}
          confirmLabel={t(language, "cabAdmin.remove")}
          cancelLabel={t(language, "cabAdmin.cancel")}
          pending={pending}
          onConfirm={handleRemove}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
