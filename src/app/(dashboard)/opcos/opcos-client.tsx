"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"
import { t } from "@/lib/i18n"
import { archiveOpCo, unarchiveOpCo } from "@/server/actions/opcos"
import ConfirmDialog from "../users/confirm-dialog"
import OpcoList from "./opco-list"
import OpcoFormDialog from "./opco-form-dialog"
import type { DbOpCo } from "./types"

interface OpcosClientProps {
  opcos: DbOpCo[]
}

export default function OpcosClient({ opcos }: OpcosClientProps) {
  const { language } = useStore()
  const router = useRouter()
  const { toast } = useToast()

  const [formOpco, setFormOpco] = useState<DbOpCo | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<DbOpCo | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = () => router.refresh()

  const toggleArchive = async (opco: DbOpCo) => {
    // Archiving is confirmed; unarchiving is immediate.
    if (!opco.archived) {
      setConfirmArchive(opco)
      return
    }
    try {
      await unarchiveOpCo(opco.id)
      toast({ title: t(language, "opcosAdmin.unarchived"), description: opco.name, variant: "success" })
      refresh()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    }
  }

  const doArchive = async () => {
    if (!confirmArchive) return
    setPending(true)
    try {
      await archiveOpCo(confirmArchive.id)
      toast({ title: t(language, "opcosAdmin.archived"), description: confirmArchive.name, variant: "success" })
      setConfirmArchive(null)
      refresh()
    } catch (err) {
      toast({ title: t(language, "opcosAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(language, "opcosAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t(language, "opcosAdmin.desc")}</p>
        </div>
        <Button onClick={() => { setFormOpco(null); setFormOpen(true) }}>
          {t(language, "opcosAdmin.new")}
        </Button>
      </div>

      <OpcoList
        opcos={opcos}
        language={language}
        onRename={(o) => { setFormOpco(o); setFormOpen(true) }}
        onArchiveToggle={toggleArchive}
      />

      {formOpen && (
        <OpcoFormDialog
          language={language}
          opco={formOpco}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refresh() }}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title={t(language, "opcosAdmin.archiveTitle")}
          body={t(language, "opcosAdmin.archiveBody")}
          confirmLabel={t(language, "opcosAdmin.archive")}
          cancelLabel={t(language, "opcosAdmin.cancel")}
          pending={pending}
          onConfirm={doArchive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </div>
  )
}
