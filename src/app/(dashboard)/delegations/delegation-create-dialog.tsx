"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toaster"
import { t, type Language } from "@/lib/i18n"
import { createDelegation } from "@/server/actions/delegations"
import { listOpCoApprovers } from "@/server/actions/users"

type Approver = { id: string; name: string | null; email: string }

interface DelegationCreateDialogProps {
  language: Language
  manageableSlugs: string[]
  onClose: () => void
  onCreated: () => void
}

export default function DelegationCreateDialog({ language, manageableSlugs, onClose, onCreated }: DelegationCreateDialogProps) {
  const { toast } = useToast()
  const [opcoSlug, setOpcoSlug] = useState(manageableSlugs[0] ?? "")
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [fromUserId, setFromUserId] = useState("")
  const [toUserId, setToUserId] = useState("")
  const [until, setUntil] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!opcoSlug) return
    listOpCoApprovers(opcoSlug).then(setApprovers).catch(() => setApprovers([]))
  }, [opcoSlug])

  const canSubmit = opcoSlug && fromUserId && toUserId && fromUserId !== toUserId && until

  const submit = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      await createDelegation({ opcoSlug, fromUserId, toUserId, validUntil: new Date(until) })
      toast({ title: t(language, "delegationsAdmin.created"), variant: "success" })
      onCreated()
    } catch (err) {
      toast({ title: t(language, "delegationsAdmin.failed"), description: err instanceof Error ? err.message : "Unknown error", variant: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <Card className="w-full max-w-md border-border/80 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">{t(language, "delegationsAdmin.createTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            aria-label={t(language, "delegationsAdmin.fieldOpco")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={opcoSlug}
            onChange={(e) => { setOpcoSlug(e.target.value); setFromUserId(""); setToUserId("") }}
          >
            {manageableSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            aria-label={t(language, "delegationsAdmin.fieldFrom")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={fromUserId}
            onChange={(e) => setFromUserId(e.target.value)}
          >
            <option value="">{t(language, "delegationsAdmin.fieldFrom")}</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <select
            aria-label={t(language, "delegationsAdmin.fieldTo")}
            className="w-full rounded border bg-background px-2 py-2 text-sm"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
          >
            <option value="">{t(language, "delegationsAdmin.fieldTo")}</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <Input type="date" aria-label={t(language, "delegationsAdmin.fieldUntil")} value={until} onChange={(e) => setUntil(e.target.value)} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>{t(language, "delegationsAdmin.cancel")}</Button>
            <Button onClick={submit} disabled={pending || !canSubmit}>{t(language, "delegationsAdmin.save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
